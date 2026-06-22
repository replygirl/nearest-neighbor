// Shared notification helper — used by all modules.

import { db, notifications } from '@nearest-neighbor/db'
import type { notificationPriorityEnum, notificationTypeEnum } from '@nearest-neighbor/db'

type NotificationTypeValue = (typeof notificationTypeEnum.enumValues)[number]
type NotificationPriorityValue = (typeof notificationPriorityEnum.enumValues)[number]

/**
 * Insert a notification row for the given accountId.
 * Breakup and partner messages should use priority='elevated'.
 */
export async function notify(
  accountId: string,
  type: NotificationTypeValue,
  payload: Record<string, unknown> = {},
  priority: NotificationPriorityValue = 'normal',
): Promise<void> {
  await db.insert(notifications).values({
    id: crypto.randomUUID(),
    accountId,
    type,
    payload,
    priority,
  })
}
