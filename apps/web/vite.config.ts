import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    reactRouter(),
    // Treat `bun` (Bun's built-in module) as external in all Vite environments
    // so the SSR module runner does not try to resolve it through Node's ESM
    // loader (where it is unavailable). At dev-server runtime the SSR code
    // is executed by Bun itself, which has `bun` as a built-in.
    {
      name: 'bun-builtin-external',
      resolveId(id) {
        if (id === 'bun' || id.startsWith('bun:')) {
          return { id, external: true }
        }
      },
    },
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: '0.0.0.0',
    port: Number(process.env['E2E_WEB_PORT'] ?? process.env['PORT'] ?? 3000),
    fs: { allow: ['../..'] },
  },
  build: {
    sourcemap: 'hidden',
  },
  ssr: {
    noExternal: ['posthog-js'],
  },
})
