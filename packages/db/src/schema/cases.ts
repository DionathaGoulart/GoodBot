import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, snowflake, text, timestamptz } from './_columns';
import { automodRules } from './automod';
import { caseSourceEnum, caseTypeEnum, scheduledActionKindEnum } from './enums';
import { guilds } from './guilds';

/** Casos de moderação (PRD §5.1). `case_number` é sequencial por guild. */
export const cases = pgTable(
  'cases',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: snowflake('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    caseNumber: integer('case_number').notNull(),
    type: caseTypeEnum('type').notNull(),
    targetId: snowflake('target_id').notNull(),
    /** Tag/username do alvo no momento do caso (histórico). */
    targetTag: text('target_tag').notNull(),
    actorId: snowflake('actor_id').notNull(),
    actorTag: text('actor_tag').notNull(),
    reason: text('reason').notNull(),
    durationMs: bigint('duration_ms', { mode: 'number' }),
    expiresAt: timestamptz('expires_at'),
    source: caseSourceEnum('source').notNull().default('command'),
    automodRuleId: uuid('automod_rule_id').references(() => automodRules.id, {
      onDelete: 'set null',
    }),
    modlogMessageId: snowflake('modlog_message_id'),
    modlogChannelId: snowflake('modlog_channel_id'),
    editedBy: snowflake('edited_by'),
    editedAt: timestamptz('edited_at'),
    /** Soft delete (`/case delete`, só admin). */
    deletedAt: timestamptz('deleted_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('cases_guild_number_uidx').on(t.guildId, t.caseNumber),
    index('cases_guild_target_idx').on(t.guildId, t.targetId),
    index('cases_guild_created_idx').on(t.guildId, sql`${t.createdAt} desc`),
    index('cases_guild_expires_idx')
      .on(t.guildId, t.expiresAt)
      .where(sql`${t.expiresAt} is not null`),
  ],
);

/** Fila do scheduler do bot (poll a cada 30s). */
export const scheduledActions = pgTable(
  'scheduled_actions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: snowflake('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    caseId: bigint('case_id', { mode: 'number' }).references(() => cases.id, {
      onDelete: 'cascade',
    }),
    kind: scheduledActionKindEnum('kind').notNull(),
    runAt: timestamptz('run_at').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    doneAt: timestamptz('done_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('scheduled_actions_pending_idx')
      .on(t.runAt)
      .where(sql`${t.doneAt} is null`),
    index('scheduled_actions_case_idx').on(t.caseId),
  ],
);
