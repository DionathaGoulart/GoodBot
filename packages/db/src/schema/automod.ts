import { sql } from 'drizzle-orm';
import { bigserial, boolean, index, integer, jsonb, pgTable, uuid } from 'drizzle-orm/pg-core';

import { createdAt, snowflake, snowflakeArray, text, updatedAt } from './_columns';
import { automodRuleTypeEnum } from './enums';
import { guilds } from './guilds';

import type { AutomodActionConfig } from '@cobot/shared';

/** Regras de automod; `config` e `actions` validados por `AutomodRuleSchema`. */
export const automodRules = pgTable(
  'automod_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: snowflake('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: automodRuleTypeEnum('type').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    priority: integer('priority').notNull().default(100),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    actions: jsonb('actions').$type<AutomodActionConfig[]>().notNull().default([]),
    exemptRoleIds: snowflakeArray('exempt_role_ids'),
    exemptChannelIds: snowflakeArray('exempt_channel_ids'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('automod_rules_guild_priority_idx').on(t.guildId, t.priority)],
);

/** Disparos de regra; retenção de 30 dias (job do bot). */
export const automodHits = pgTable(
  'automod_hits',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: snowflake('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => automodRules.id, { onDelete: 'cascade' }),
    userId: snowflake('user_id').notNull(),
    channelId: snowflake('channel_id'),
    messageId: snowflake('message_id'),
    /** Ações efetivamente executadas (ex.: `delete,timeout`). */
    actionTaken: text('action_taken').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [
    index('automod_hits_guild_created_idx').on(t.guildId, sql`${t.createdAt} desc`),
    index('automod_hits_rule_idx').on(t.ruleId),
  ],
);
