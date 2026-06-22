import { PHProvider } from '@nearest-neighbor/analytics/web'
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router'

import type { Route } from './+types/root'

// @ts-ignore css side-effect import
import './app.css'

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <PHProvider>{children}</PHProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  return <Outlet />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(error)) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-4xl font-bold">{error.status}</h1>
        <p className="text-lg opacity-60">{error.statusText}</p>
      </div>
    )
  }

  const message = error instanceof Error ? error.message : 'Unknown error'
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="opacity-60">{message}</p>
    </div>
  )
}
