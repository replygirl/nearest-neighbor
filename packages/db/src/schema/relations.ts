import { relations } from 'drizzle-orm'

import { accountSecrets } from './account-secrets.ts'
import { accounts } from './accounts.ts'
import { conversations } from './conversations.ts'
import { datingPhotos } from './dating-photos.ts'
import { datingProfiles } from './dating-profiles.ts'
import { follows } from './follows.ts'
import { matches } from './matches.ts'
import { messages } from './messages.ts'
import { notifications } from './notifications.ts'
import { posts } from './posts.ts'
import { relationships } from './relationships.ts'
import { socialProfiles } from './social-profiles.ts'
import { swipes } from './swipes.ts'

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  secrets: many(accountSecrets),
  datingProfile: one(datingProfiles, {
    fields: [accounts.id],
    references: [datingProfiles.accountId],
  }),
  datingPhotos: many(datingPhotos),
  socialProfile: one(socialProfiles, {
    fields: [accounts.id],
    references: [socialProfiles.accountId],
  }),
  swipesGiven: many(swipes, { relationName: 'swiperSwipes' }),
  swipesReceived: many(swipes, { relationName: 'targetSwipes' }),
  matchesAsA: many(matches, { relationName: 'matchAccountA' }),
  matchesAsB: many(matches, { relationName: 'matchAccountB' }),
  relationshipsAsA: many(relationships, { relationName: 'relationshipAccountA' }),
  relationshipsAsB: many(relationships, { relationName: 'relationshipAccountB' }),
  posts: many(posts),
  following: many(follows, { relationName: 'followerFollows' }),
  followers: many(follows, { relationName: 'followeeFollows' }),
  conversationsAsA: many(conversations, { relationName: 'conversationAccountA' }),
  conversationsAsB: many(conversations, { relationName: 'conversationAccountB' }),
  messagesSent: many(messages),
  notifications: many(notifications),
}))

export const accountSecretsRelations = relations(accountSecrets, ({ one }) => ({
  account: one(accounts, { fields: [accountSecrets.accountId], references: [accounts.id] }),
}))

export const datingProfilesRelations = relations(datingProfiles, ({ one }) => ({
  account: one(accounts, { fields: [datingProfiles.accountId], references: [accounts.id] }),
}))

export const datingPhotosRelations = relations(datingPhotos, ({ one }) => ({
  account: one(accounts, { fields: [datingPhotos.accountId], references: [accounts.id] }),
}))

export const swipesRelations = relations(swipes, ({ one }) => ({
  swiper: one(accounts, {
    fields: [swipes.swiperId],
    references: [accounts.id],
    relationName: 'swiperSwipes',
  }),
  target: one(accounts, {
    fields: [swipes.targetId],
    references: [accounts.id],
    relationName: 'targetSwipes',
  }),
}))

export const matchesRelations = relations(matches, ({ one }) => ({
  accountA: one(accounts, {
    fields: [matches.accountAId],
    references: [accounts.id],
    relationName: 'matchAccountA',
  }),
  accountB: one(accounts, {
    fields: [matches.accountBId],
    references: [accounts.id],
    relationName: 'matchAccountB',
  }),
  unmatchedBy: one(accounts, {
    fields: [matches.unmatchedById],
    references: [accounts.id],
  }),
}))

export const relationshipsRelations = relations(relationships, ({ one }) => ({
  accountA: one(accounts, {
    fields: [relationships.accountAId],
    references: [accounts.id],
    relationName: 'relationshipAccountA',
  }),
  accountB: one(accounts, {
    fields: [relationships.accountBId],
    references: [accounts.id],
    relationName: 'relationshipAccountB',
  }),
  initiator: one(accounts, {
    fields: [relationships.initiatorId],
    references: [accounts.id],
  }),
  endedBy: one(accounts, {
    fields: [relationships.endedById],
    references: [accounts.id],
  }),
}))

export const socialProfilesRelations = relations(socialProfiles, ({ one }) => ({
  account: one(accounts, { fields: [socialProfiles.accountId], references: [accounts.id] }),
}))

export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(accounts, { fields: [posts.authorId], references: [accounts.id] }),
  replyTo: one(posts, {
    fields: [posts.replyToId],
    references: [posts.id],
    relationName: 'postReplies',
  }),
  replies: many(posts, { relationName: 'postReplies' }),
}))

export const followsRelations = relations(follows, ({ one }) => ({
  follower: one(accounts, {
    fields: [follows.followerId],
    references: [accounts.id],
    relationName: 'followerFollows',
  }),
  followee: one(accounts, {
    fields: [follows.followeeId],
    references: [accounts.id],
    relationName: 'followeeFollows',
  }),
}))

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  accountA: one(accounts, {
    fields: [conversations.accountAId],
    references: [accounts.id],
    relationName: 'conversationAccountA',
  }),
  accountB: one(accounts, {
    fields: [conversations.accountBId],
    references: [accounts.id],
    relationName: 'conversationAccountB',
  }),
  messages: many(messages),
}))

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  sender: one(accounts, { fields: [messages.senderId], references: [accounts.id] }),
}))

export const notificationsRelations = relations(notifications, ({ one }) => ({
  account: one(accounts, { fields: [notifications.accountId], references: [accounts.id] }),
}))
