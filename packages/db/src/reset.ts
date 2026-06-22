/**
 * Truncate all application tables in dependency order.
 * Run via: mise run db:reset
 *
 * WARNING: destroys all data. Dev/test environments only.
 */
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

async function reset() {
  const sqlClient = postgres(process.env['DATABASE_URL']!)
  const db = drizzle(sqlClient, { casing: 'snake_case' })

  // Truncate in reverse-dependency order (leaf tables first) to avoid FK violations.
  // CASCADE handles any remaining transitive deps.
  await db.execute(sql`
    TRUNCATE
      notifications,
      messages,
      conversations,
      follows,
      posts,
      relationships,
      matches,
      swipes,
      dating_photos,
      dating_profiles,
      social_profiles,
      account_secrets,
      accounts
    RESTART IDENTITY CASCADE
  `)

  console.log('All application tables truncated.')

  await sqlClient.end()
}

reset().catch((err) => {
  console.error('Reset failed:', err)
  process.exit(1)
})
