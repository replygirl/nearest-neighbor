import { PostHogProvider } from '@posthog/react'
import posthog from 'posthog-js'
import { createElement, type ReactNode } from 'react'

const POSTHOG_PROXY_HOST = 'https://k.nearest-neighbor.replygirl.club'
const POSTHOG_UI_HOST = 'https://us.posthog.com'

export function initWebAnalytics(): void {
  if (typeof window === 'undefined') return
  if (!import.meta.env['VITE_POSTHOG_KEY']) return

  posthog.init(import.meta.env['VITE_POSTHOG_KEY'] as string, {
    api_host: (import.meta.env['VITE_POSTHOG_HOST'] as string | undefined) ?? POSTHOG_PROXY_HOST,
    ui_host: POSTHOG_UI_HOST,
    defaults: '2026-05-30',
    session_recording: {
      maskAllInputs: true,
      maskInputOptions: { password: true },
      maskTextSelector: '[data-ph-mask]',
    },
  })
}

if (typeof window !== 'undefined' && import.meta.env['VITE_POSTHOG_KEY']) {
  initWebAnalytics()
}

export { posthog }

export function PHProvider({ children }: { children: ReactNode }) {
  return createElement(PostHogProvider, { client: posthog }, children)
}

export { usePostHog } from '@posthog/react'
