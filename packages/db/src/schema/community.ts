import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, snowflake, snowflakeArray, text, timestamptz, updatedAt } from './_columns';
import {
  lfgMemberStatusEnum,
  lfgSessionStatusEnum,
  lfgVisibilityEnum,
  reactionRoleModeEnum,
  reactionRoleStyleEnum,
  ticketStatusEnum,
} from './enums';
import { guilds } from './guilds';

import type { MessageTemplate } from '@goodbot/shared';

const guildRef = () =>
  snowflake('guild_id')
    .notNull()
    .references(() => guilds.id, { onDelete: 'cascade' });

// ── Boas-vindas ─────────────────────────────────────────────────────────────

/** Espelha `WelcomeConfig` em colunas; templates validados por `MessageTemplateSchema`. */
export const welcomeConfigs = pgTable('welcome_configs', {
  guildId: guildRef().primaryKey(),
  joinEnabled: boolean('join_enabled').notNull().default(false),
  joinChannelId: snowflake('join_channel_id'),
  joinTemplate: jsonb('join_template').$type<MessageTemplate>(),
  leaveEnabled: boolean('leave_enabled').notNull().default(false),
  leaveChannelId: snowflake('leave_channel_id'),
  leaveTemplate: jsonb('leave_template').$type<MessageTemplate>(),
  dmEnabled: boolean('dm_enabled').notNull().default(false),
  dmTemplate: jsonb('dm_template').$type<MessageTemplate>(),
  updatedAt: updatedAt(),
});

// ── Autorole ────────────────────────────────────────────────────────────────

export const autoroleConfigs = pgTable('autorole_configs', {
  guildId: guildRef().primaryKey(),
  humanRoleIds: snowflakeArray('human_role_ids'),
  botRoleIds: snowflakeArray('bot_role_ids'),
  delaySeconds: integer('delay_s').notNull().default(0),
  verifyEnabled: boolean('verify_enabled').notNull().default(false),
  verifyChannelId: snowflake('verify_channel_id'),
  verifyMessageId: snowflake('verify_message_id'),
  verifyRoleId: snowflake('verify_role_id'),
  updatedAt: updatedAt(),
});

// ── Reaction roles ──────────────────────────────────────────────────────────

export const reactionRolePanels = pgTable(
  'reaction_role_panels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: guildRef(),
    channelId: snowflake('channel_id').notNull(),
    /** `null` até ser publicado. */
    messageId: snowflake('message_id'),
    mode: reactionRoleModeEnum('mode').notNull().default('toggle'),
    style: reactionRoleStyleEnum('style').notNull().default('buttons'),
    content: jsonb('content').$type<MessageTemplate>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('reaction_role_panels_guild_idx').on(t.guildId),
    uniqueIndex('reaction_role_panels_message_uidx').on(t.messageId),
  ],
);

export const reactionRoleItems = pgTable(
  'reaction_role_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    panelId: uuid('panel_id')
      .notNull()
      .references(() => reactionRolePanels.id, { onDelete: 'cascade' }),
    roleId: snowflake('role_id').notNull(),
    /** Unicode ou `name:id` de emoji customizado. */
    emoji: text('emoji'),
    label: text('label').notNull(),
    description: text('description'),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    index('reaction_role_items_panel_idx').on(t.panelId, t.position),
    uniqueIndex('reaction_role_items_panel_role_uidx').on(t.panelId, t.roleId),
  ],
);

// ── Tickets ─────────────────────────────────────────────────────────────────

export const ticketTypes = pgTable(
  'ticket_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: guildRef(),
    name: text('name').notNull(),
    categoryId: snowflake('category_id').notNull(),
    supportRoleIds: snowflakeArray('support_role_ids'),
    openingMessage: jsonb('opening_message').$type<MessageTemplate>(),
    /** `null` = usar `TicketsConfig.maxOpenPerUserDefault`. */
    maxOpenPerUser: integer('max_open_per_user'),
    namingPattern: text('naming_pattern'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('ticket_types_guild_name_uidx').on(t.guildId, t.name)],
);

export const ticketPanels = pgTable(
  'ticket_panels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: guildRef(),
    channelId: snowflake('channel_id').notNull(),
    messageId: snowflake('message_id'),
    content: jsonb('content').$type<MessageTemplate>().notNull(),
    /** Tipos oferecidos no painel (N—N por array, PRD §8). */
    typeIds: uuid('type_ids')
      .array()
      .notNull()
      .default([] as string[]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('ticket_panels_guild_idx').on(t.guildId)],
);

export const tickets = pgTable(
  'tickets',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: guildRef(),
    /** Sequencial por guild. */
    number: integer('number').notNull(),
    typeId: uuid('type_id').references(() => ticketTypes.id, { onDelete: 'set null' }),
    userId: snowflake('user_id').notNull(),
    /** Canal ou thread do ticket. */
    channelId: snowflake('channel_id').notNull(),
    status: ticketStatusEnum('status').notNull().default('open'),
    claimedBy: snowflake('claimed_by'),
    closedBy: snowflake('closed_by'),
    closeReason: text('close_reason'),
    transcriptUrl: text('transcript_url'),
    openedAt: timestamptz('opened_at').notNull().defaultNow(),
    closedAt: timestamptz('closed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('tickets_guild_number_uidx').on(t.guildId, t.number),
    index('tickets_guild_user_status_idx').on(t.guildId, t.userId, t.status),
    uniqueIndex('tickets_channel_uidx').on(t.channelId),
  ],
);

// ── Tags ────────────────────────────────────────────────────────────────────

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: guildRef(),
    name: text('name').notNull(),
    content: jsonb('content').$type<MessageTemplate>().notNull(),
    createdBy: snowflake('created_by').notNull(),
    uses: integer('uses').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('tags_guild_name_uidx').on(t.guildId, t.name)],
);

// ── Agenda de jogatinas (módulo squads) ─────────────────────────────────────

/**
 * Uma jogatina marcada no canal da agenda (PRD §5.11). Salas e cargo do módulo
 * continuam sendo estado do Discord; a agenda precisa de tabela porque lista,
 * vagas e relógio sobrevivem a restart. Os `*_at` do relógio são o que torna
 * cada passo idempotente: o tick só faz o que ainda está nulo.
 */
export const lfgSessions = pgTable(
  'lfg_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: guildRef(),
    hostId: snowflake('host_id').notNull(),
    startsAt: timestamptz('starts_at').notNull(),
    /** Contando o host, de `LFG_MIN_SLOTS` a `LFG_MAX_SLOTS`. */
    slots: integer('slots').notNull(),
    visibility: lfgVisibilityEnum('visibility').notNull().default('open'),
    note: text('note'),
    status: lfgSessionStatusEnum('status').notNull().default('scheduled'),
    /** A mensagem na agenda e a thread dela. `null` até o bot postar. */
    channelId: snowflake('channel_id'),
    messageId: snowflake('message_id'),
    threadId: snowflake('thread_id'),
    /** A sala `Squad <grego>` criada no início. */
    roomId: snowflake('room_id'),
    remindedAt: timestamptz('reminded_at'),
    calledAt: timestamptz('called_at'),
    startedAt: timestamptz('started_at'),
    endedAt: timestamptz('ended_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('lfg_sessions_guild_starts_idx').on(t.guildId, t.startsAt),
    index('lfg_sessions_open_idx')
      .on(t.startsAt)
      .where(sql`${t.status} in ('scheduled', 'live')`),
    uniqueIndex('lfg_sessions_message_uidx').on(t.messageId),
  ],
);

/** Quem está em cada jogatina, e como: host, vai, fila ou pediu. */
export const lfgSessionMembers = pgTable(
  'lfg_session_members',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => lfgSessions.id, { onDelete: 'cascade' }),
    userId: snowflake('user_id').notNull(),
    status: lfgMemberStatusEnum('status').notNull(),
    /** Ordem de chegada: decide a fila. */
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.userId] }),
    index('lfg_session_members_user_idx').on(t.userId),
  ],
);
