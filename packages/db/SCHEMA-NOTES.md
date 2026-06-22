# Schema Notes

Design decisions, known gaps, and deferred work for `packages/db/src/schema/*`.

> This file is maintained by hand. Add a note here when a schema change is
> nontrivial or deferred to avoid editing a migration directly.

---

## ID and timestamp conventions

- **UUID PKs**: `uuid('id').primaryKey().defaultRandom()` on all surrogate-keyed
  tables. Generates `gen_random_uuid()` at the DB level.
- **All timestamps**: `{ withTimezone: true }` — stored in UTC, returned with
  timezone offset.
- **Mutable tables** spread the `timestamps` helper from `_helpers.ts`, which
  provides `created_at` + `updated_at`. The `updated_at` column uses
  `$onUpdateFn(() => new Date())` at the Drizzle ORM layer — rows modified via
  raw SQL or another client will **not** auto-update `updated_at`.
- **Append-only tables** (swipes, follows, messages, notifications,
  account_secrets) declare only `created_at` — no `updated_at`. Changes to these
  records should be delete + re-insert.

### Tables and their timestamp pattern

| Table             | Pattern      | Notes                                         |
| ----------------- | ------------ | --------------------------------------------- |
| `accounts`        | `timestamps` | Mutable (status changes)                      |
| `account_secrets` | `created_at` | Append-only-ish; revoked_at/last_used_at cols |
| `dating_profiles` | `timestamps` | Mutable profile data                          |
| `dating_photos`   | `created_at` | Append-only; delete + re-insert to update     |
| `swipes`          | `created_at` | Append-only; unique(swiper, target) enforces  |
| `matches`         | `created_at` | Status/unmatch cols updated in place          |
| `relationships`   | `timestamps` | State transitions tracked in-place            |
| `social_profiles` | `timestamps` | Mutable profile data                          |
| `posts`           | `timestamps` | Mutable; soft-delete via `deleted_at`         |
| `follows`         | `created_at` | Append-only; composite PK                     |
| `conversations`   | `created_at` | Unlock timestamps updated in-place            |
| `messages`        | `created_at` | Append-only; `read_at` updated in-place       |
| `notifications`   | `created_at` | Append-only; `read_at` updated in-place       |

---

## Ordered-pair pattern (matches / relationships / conversations)

Three tables represent relationships between two accounts. To avoid duplicates
(e.g., both `(alice, bob)` and `(bob, alice)`) we enforce **account_a_id <
account_b_id** at the DB level via a CHECK constraint.

Application code must sort the two IDs before inserting:

```ts
const [a, b] = [id1, id2].sort()
db.insert(matches).values({ accountAId: a, accountBId: b, ... })
```

A utility `orderedPair(a, b)` is exported from `@nearest-neighbor/db` for this
purpose.

### Tables using ordered pairs

| Table           | Unique constraint                    | Rationale                               |
| --------------- | ------------------------------------ | --------------------------------------- |
| `matches`       | `UNIQUE(account_a_id, account_b_id)` | One active match per pair (deduped)     |
| `conversations` | `UNIQUE(account_a_id, account_b_id)` | One shared convo per pair               |
| `relationships` | None (CHECK only)                    | Poly + history; app-enforced uniqueness |

---

## Shared-conversation unlock design

One row in `conversations` per unordered account pair. Two independent unlock
timestamps track which messaging contexts are open:

- `dating_unlocked_at`: set when a match is created; nulled on unmatch.
- `social_unlocked_at`: set when a DM is initiated (mutual-follow OR recipient
  `open_dms=true`).

A conversation is accessible if **at least one** context is unlocked. Messages
are shared across both contexts — history persists even if one context closes.

This cleanly handles the "match after already following" case: the conversation
already exists, matching simply unlocks the dating context; prior message
history carries over.

---

## No citext — case-insensitive handle index instead

`social_profiles.handle` requires case-insensitive uniqueness (`@Alice` and
`@alice` must not coexist). We chose **not** to use the `citext` extension
because PGlite (used in integration tests) does not include it.

Instead, migration `0000_lonely_miek.sql` appends:

```sql
CREATE UNIQUE INDEX "idx_social_profiles_handle_lower"
  ON "social_profiles" USING btree (lower("handle"));
```

Application code must `lower()` when querying by handle:

```ts
db.select()
  .from(socialProfiles)
  .where(sql`lower(${socialProfiles.handle}) = ${handle.toLowerCase()}`)
```

---

## Soft-delete pattern

`posts` carries a `deleted_at` timestamp for soft deletes. The
`withSoftDelete(table)` helper from `_helpers.ts` generates a
`WHERE deleted_at IS NULL` clause:

```ts
import { withSoftDelete } from '@nearest-neighbor/db'
db.select().from(posts).where(withSoftDelete(posts).where)
```

Other tables (`accounts`, `dating_profiles`, `relationships`) do not currently
have soft-delete logic wired at the application layer — deferred to a later
phase.

---

## No better-auth / no separate auth schema

All auth tables (`accounts`, `account_secrets`) live in the public schema. There
is no better-auth or separate `auth.*` pgSchema. Authentication is handled by
the API layer using JOSE JWTs and high-entropy bearer secrets hashed with
SHA-256.
