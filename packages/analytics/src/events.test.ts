import { describe, expect, mock, test } from 'bun:test'

import { captureEvent, EventProperties, Events, type EventPropertiesMap } from './events.ts'

describe('Events', () => {
  test('Events const has expected keys', () => {
    expect(Events.AGENT_SIGNED_UP).toBe('agent.signed_up')
    expect(Events.SWIPE_CREATED).toBe('swipe.created')
    expect(Events.MATCH_CREATED).toBe('match.created')
    expect(Events.CLI_COMMAND).toBe('cli.command')
    expect(Events.API_REQUEST).toBe('api.request')
    expect(Events.BREAKUP).toBe('breakup')
  })

  test('EventProperties covers every event name', () => {
    const eventNames = Object.values(Events)
    for (const name of eventNames) {
      // Use `in` rather than toHaveProperty — keys contain dots which toHaveProperty
      // interprets as nested path navigation.
      expect(name in EventProperties).toBe(true)
    }
  })

  test('EventProperties schemas are TypeBox objects with properties', () => {
    const schema = EventProperties['swipe.created']
    expect(schema).toBeDefined()
    expect(schema.type).toBe('object')
    expect(schema.properties).toHaveProperty('swiper_id')
    expect(schema.properties).toHaveProperty('direction')
  })
})

describe('captureEvent', () => {
  test('calls client.capture with distinctId, name, and props', () => {
    const mockCapture = mock(() => undefined)
    const client = { capture: mockCapture }

    const props: EventPropertiesMap['swipe.created'] = {
      swiper_id: 'agent-1',
      target_id: 'agent-2',
      direction: 'like',
    }

    captureEvent(client, 'distinct-xyz', Events.SWIPE_CREATED, props)

    expect(mockCapture).toHaveBeenCalledTimes(1)
    expect(mockCapture).toHaveBeenCalledWith('distinct-xyz', 'swipe.created', props)
  })

  test('passes cli.command props correctly', () => {
    const mockCapture = mock(() => undefined)
    const client = { capture: mockCapture }

    captureEvent(client, 'agent-cli', Events.CLI_COMMAND, {
      command: 'match',
      subcommand: 'list',
    })

    expect(mockCapture).toHaveBeenCalledWith('agent-cli', 'cli.command', {
      command: 'match',
      subcommand: 'list',
    })
  })

  test('passes api.request props correctly', () => {
    const mockCapture = mock(() => undefined)
    const client = { capture: mockCapture }

    captureEvent(client, 'server', Events.API_REQUEST, {
      method: 'GET',
      route: '/agents',
      status: 200,
    })

    expect(mockCapture).toHaveBeenCalledWith('server', 'api.request', {
      method: 'GET',
      route: '/agents',
      status: 200,
    })
  })
})
