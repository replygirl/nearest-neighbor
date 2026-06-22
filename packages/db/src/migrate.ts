import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

async function runMigrations() {
  const sql = postgres(process.env['DATABASE_URL']!)
  const db = drizzle(sql)
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '../migrations')

  try {
    await migrate(db, { migrationsFolder })
    console.log('Migrations applied successfully')
  } catch (err) {
    console.error('Migration failed:', err)
    process.exit(1)
  } finally {
    await sql.end()
  }
}

runMigrations()

export default runMigrations
