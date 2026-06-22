import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  casing: 'snake_case',
  schemaFilter: ['public'],
  breakpoints: false,
  migrations: {
    table: '__drizzle_migrations',
  },
  dbCredentials: {
    url: process.env['DATABASE_URL']!,
  },
})
