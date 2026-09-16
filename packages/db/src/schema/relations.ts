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
import {
  squadGames,
  squadJoinRequests,
  squadMembers,
  squadProfiles,
  squadProposals,
  squads,
  squadSessionAttendance,
  squadSessions,
} from './squads';
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
  squadGames: many(squadGames),
  squadProfiles: many(squadProfiles),
  squads: many(squads),
  squadMembers: many(squadMembers),
  squadProposals: many(squadProposals),
  squadJoinRequests: many(squadJoinRequests),
  squadSessions: many(squadSessions),
  squadSessionAttendance: many(squadSessionAttendance),
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

export const squadGamesRelations = relations(squadGames, ({ one, many }) => ({
  guild: one(guilds, { fields: [squadGames.guildId], references: [guilds.id] }),
  profiles: many(squadProfiles),
  squads: many(squads),
  proposals: many(squadProposals),
}));

export const squadProfilesRelations = relations(squadProfiles, ({ one }) => ({
  guild: one(guilds, { fields: [squadProfiles.guildId], references: [guilds.id] }),
  game: one(squadGames, { fields: [squadProfiles.gameId], references: [squadGames.id] }),
}));

export const squadsRelations = relations(squads, ({ one, many }) => ({
  guild: one(guilds, { fields: [squads.guildId], references: [guilds.id] }),
  game: one(squadGames, { fields: [squads.gameId], references: [squadGames.id] }),
  members: many(squadMembers),
  proposals: many(squadProposals),
  joinRequests: many(squadJoinRequests),
  sessions: many(squadSessions),
}));

export const squadMembersRelations = relations(squadMembers, ({ one }) => ({
  guild: one(guilds, { fields: [squadMembers.guildId], references: [guilds.id] }),
  squad: one(squads, { fields: [squadMembers.squadId], references: [squads.id] }),
}));

export const squadProposalsRelations = relations(squadProposals, ({ one }) => ({
  guild: one(guilds, { fields: [squadProposals.guildId], references: [guilds.id] }),
  game: one(squadGames, { fields: [squadProposals.gameId], references: [squadGames.id] }),
  squad: one(squads, { fields: [squadProposals.squadId], references: [squads.id] }),
}));

export const squadJoinRequestsRelations = relations(squadJoinRequests, ({ one }) => ({
  guild: one(guilds, { fields: [squadJoinRequests.guildId], references: [guilds.id] }),
  squad: one(squads, { fields: [squadJoinRequests.squadId], references: [squads.id] }),
  session: one(squadSessions, {
    fields: [squadJoinRequests.sessionId],
    references: [squadSessions.id],
  }),
}));

export const squadSessionsRelations = relations(squadSessions, ({ one, many }) => ({
  guild: one(guilds, { fields: [squadSessions.guildId], references: [guilds.id] }),
  squad: one(squads, { fields: [squadSessions.squadId], references: [squads.id] }),
  attendance: many(squadSessionAttendance),
}));

export const squadSessionAttendanceRelations = relations(squadSessionAttendance, ({ one }) => ({
  guild: one(guilds, { fields: [squadSessionAttendance.guildId], references: [guilds.id] }),
  session: one(squadSessions, {
    fields: [squadSessionAttendance.sessionId],
    references: [squadSessions.id],
  }),
}));
