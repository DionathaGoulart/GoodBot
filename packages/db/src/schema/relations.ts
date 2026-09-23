import { relations } from 'drizzle-orm';

import { auditLogs } from './audit';
import { automodHits, automodRules } from './automod';
import { cases, scheduledActions } from './cases';
import {
  autoroleConfigs,
  reactionRoleItems,
  reactionRolePanels,
  tags,
  ticketPanels,
  tickets,
  ticketTypes,
  welcomeConfigs,
} from './community';
import { guildSettings, logConfigs, moduleConfigs } from './configs';
import { guilds } from './guilds';
import { messageCache } from './messages';
import { channelLocks, polls, reminders } from './misc';
import { statBuckets } from './stats';

export const guildsRelations = relations(guilds, ({ one, many }) => ({
  settings: one(guildSettings, { fields: [guilds.id], references: [guildSettings.guildId] }),
  moduleConfigs: many(moduleConfigs),
  logConfigs: many(logConfigs),
  cases: many(cases),
  scheduledActions: many(scheduledActions),
  automodRules: many(automodRules),
  automodHits: many(automodHits),
  messageCache: many(messageCache),
  welcomeConfig: one(welcomeConfigs, {
    fields: [guilds.id],
    references: [welcomeConfigs.guildId],
  }),
  autoroleConfig: one(autoroleConfigs, {
    fields: [guilds.id],
    references: [autoroleConfigs.guildId],
  }),
  reactionRolePanels: many(reactionRolePanels),
  ticketTypes: many(ticketTypes),
  ticketPanels: many(ticketPanels),
  tickets: many(tickets),
  tags: many(tags),
  reminders: many(reminders),
  polls: many(polls),
  statBuckets: many(statBuckets),
  channelLocks: many(channelLocks),
  auditLogs: many(auditLogs),
}));

export const guildSettingsRelations = relations(guildSettings, ({ one }) => ({
  guild: one(guilds, { fields: [guildSettings.guildId], references: [guilds.id] }),
}));

export const moduleConfigsRelations = relations(moduleConfigs, ({ one }) => ({
  guild: one(guilds, { fields: [moduleConfigs.guildId], references: [guilds.id] }),
}));

export const logConfigsRelations = relations(logConfigs, ({ one }) => ({
  guild: one(guilds, { fields: [logConfigs.guildId], references: [guilds.id] }),
}));

export const casesRelations = relations(cases, ({ one, many }) => ({
  guild: one(guilds, { fields: [cases.guildId], references: [guilds.id] }),
  automodRule: one(automodRules, {
    fields: [cases.automodRuleId],
    references: [automodRules.id],
  }),
  scheduledActions: many(scheduledActions),
}));

export const scheduledActionsRelations = relations(scheduledActions, ({ one }) => ({
  guild: one(guilds, { fields: [scheduledActions.guildId], references: [guilds.id] }),
  case: one(cases, { fields: [scheduledActions.caseId], references: [cases.id] }),
}));

export const automodRulesRelations = relations(automodRules, ({ one, many }) => ({
  guild: one(guilds, { fields: [automodRules.guildId], references: [guilds.id] }),
  hits: many(automodHits),
  cases: many(cases),
}));

export const automodHitsRelations = relations(automodHits, ({ one }) => ({
  guild: one(guilds, { fields: [automodHits.guildId], references: [guilds.id] }),
  rule: one(automodRules, { fields: [automodHits.ruleId], references: [automodRules.id] }),
}));

export const reactionRolePanelsRelations = relations(reactionRolePanels, ({ one, many }) => ({
  guild: one(guilds, { fields: [reactionRolePanels.guildId], references: [guilds.id] }),
  items: many(reactionRoleItems),
}));

export const reactionRoleItemsRelations = relations(reactionRoleItems, ({ one }) => ({
  panel: one(reactionRolePanels, {
    fields: [reactionRoleItems.panelId],
    references: [reactionRolePanels.id],
  }),
}));

export const ticketTypesRelations = relations(ticketTypes, ({ one, many }) => ({
  guild: one(guilds, { fields: [ticketTypes.guildId], references: [guilds.id] }),
  tickets: many(tickets),
}));

export const ticketsRelations = relations(tickets, ({ one }) => ({
  guild: one(guilds, { fields: [tickets.guildId], references: [guilds.id] }),
  type: one(ticketTypes, { fields: [tickets.typeId], references: [ticketTypes.id] }),
}));

export const remindersRelations = relations(reminders, ({ one }) => ({
  guild: one(guilds, { fields: [reminders.guildId], references: [guilds.id] }),
}));

export const pollsRelations = relations(polls, ({ one }) => ({
  guild: one(guilds, { fields: [polls.guildId], references: [guilds.id] }),
}));

export const channelLocksRelations = relations(channelLocks, ({ one }) => ({
  guild: one(guilds, { fields: [channelLocks.guildId], references: [guilds.id] }),
}));
