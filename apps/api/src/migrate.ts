/**
 * Standalone migration entry point compiled into /app/migrate by the
 * Dockerfile. Used as the Fly.io release_command so migrations run from
 * the distroless runtime image without needing bun or a shell.
 *
 * The migrations folder is resolved from DATABASE_URL and a fixed path
 * baked into the image at /app/migrations (COPY --from=builder in Dockerfile).
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const MIGRATIONS_FOLDER = process.env['MIGRATIONS_FOLDER'] ?? '/app/migrations'
const DATABASE_URL = process.env['DATABASE_URL']

if (!DATABASE_URL) {
  console.error('[migrate] DATABASE_URL is not set — cannot run migrations')
  process.exit(1)
}

async function runMigrations() {
  const sql = postgres(DATABASE_URL!)
  const db = drizzle(sql)

  try {
    console.log(`[migrate] applying migrations from ${MIGRATIONS_FOLDER}`)
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
    console.log('[migrate] done')
  } catch (err) {
    console.error('[migrate] failed:', err)
    process.exit(1)
  } finally {
    await sql.end()
  }
}

runMigrations()
