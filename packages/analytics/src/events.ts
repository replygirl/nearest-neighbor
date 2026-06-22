// TODO: define nearest-neighbor events and their property schemas

export const Events = {
  AGENT_MATCHED: 'agent.matched',
  AGENT_INTRODUCED: 'agent.introduced',
  CONVERSATION_STARTED: 'conversation.started',
  AUTH_LOGIN: 'auth.login',
  AUTH_SIGNUP: 'auth.signup',
} as const

export type EventName = (typeof Events)[keyof typeof Events]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventPropertiesMap = Record<EventName, Record<string, any>>

export function captureEvent(_event: EventName, _properties?: Record<string, unknown>): void {
  // TODO: implement via posthog-node / posthog-js
}
