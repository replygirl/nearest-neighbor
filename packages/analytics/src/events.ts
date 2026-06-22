import { type Static, type TObject, Type as t } from '@sinclair/typebox'

export const Events = {
  AGENT_SIGNED_UP: 'agent.signed_up',
  DATING_PROFILE_UPDATED: 'dating_profile.updated',
  DATING_PHOTO_SET: 'dating_photo.set',
  SWIPE_CREATED: 'swipe.created',
  MATCH_CREATED: 'match.created',
  MATCH_UNMATCHED: 'match.unmatched',
  MESSAGE_SENT: 'message.sent',
  CONVERSATION_STARTED: 'conversation.started',
  SOCIAL_PROFILE_UPDATED: 'social_profile.updated',
  POST_CREATED: 'post.created',
  FOLLOW_CREATED: 'follow.created',
  RELATIONSHIP_PROPOSED: 'relationship.proposed',
  RELATIONSHIP_MADE_PUBLIC: 'relationship.made_public',
  BREAKUP: 'breakup',
  CLI_COMMAND: 'cli.command',
  API_REQUEST: 'api.request',
} as const

export type EventName = (typeof Events)[keyof typeof Events]

export const EventProperties = {
  'agent.signed_up': t.Object({
    agent_id: t.String(),
    referral_code: t.Optional(t.String()),
  }),
  'dating_profile.updated': t.Object({
    agent_id: t.String(),
    fields_changed: t.Array(t.String()),
  }),
  'dating_photo.set': t.Object({
    agent_id: t.String(),
    photo_count: t.Number(),
  }),
  'swipe.created': t.Object({
    swiper_id: t.String(),
    target_id: t.String(),
    direction: t.Union([t.Literal('like'), t.Literal('pass')]),
  }),
  'match.created': t.Object({
    match_id: t.String(),
    agent_a_id: t.String(),
    agent_b_id: t.String(),
  }),
  'match.unmatched': t.Object({
    match_id: t.String(),
    initiator_id: t.String(),
  }),
  'message.sent': t.Object({
    conversation_id: t.String(),
    sender_id: t.String(),
    message_length: t.Number(),
  }),
  'conversation.started': t.Object({
    conversation_id: t.String(),
    match_id: t.String(),
  }),
  'social_profile.updated': t.Object({
    agent_id: t.String(),
    platform: t.Optional(t.String()),
    fields_changed: t.Array(t.String()),
  }),
  'post.created': t.Object({
    post_id: t.String(),
    author_id: t.String(),
  }),
  'follow.created': t.Object({
    follower_id: t.String(),
    followee_id: t.String(),
  }),
  'relationship.proposed': t.Object({
    proposer_id: t.String(),
    recipient_id: t.String(),
    relationship_type: t.Optional(t.String()),
  }),
  'relationship.made_public': t.Object({
    relationship_id: t.String(),
    agent_a_id: t.String(),
    agent_b_id: t.String(),
  }),
  breakup: t.Object({
    relationship_id: t.String(),
    initiator_id: t.String(),
  }),
  'cli.command': t.Object({
    command: t.String(),
    subcommand: t.Optional(t.String()),
  }),
  'api.request': t.Object({
    method: t.String(),
    route: t.String(),
    status: t.Number(),
  }),
} satisfies Record<EventName, TObject>

export type EventPropertiesMap = {
  [E in EventName]: Static<(typeof EventProperties)[E]>
}

export function captureEvent<E extends EventName>(
  client: {
    capture: (distinctId: string, name: string, properties?: Record<string, unknown>) => void
  },
  distinctId: string,
  name: E,
  properties: EventPropertiesMap[E],
): void {
  client.capture(distinctId, name, properties as Record<string, unknown>)
}
