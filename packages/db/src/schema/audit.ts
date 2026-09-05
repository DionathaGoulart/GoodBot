import { sql } from 'drizzle-orm';
import { bigserial, index, jsonb, pgTable } from 'drizzle-orm/pg-core';

import { createdAt, snowflake, text } from './_columns';
import { guilds } from './guilds';

/** Auditoria do painel — append-only (PRD §6.5). */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: snowflake('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    actorId: snowflake('actor_id').notNull(),
    actorTag: text('actor_tag').notNull(),
    /** Ex.: `config.update`, `case.edit`, `member.ban`. */
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    before: jsonb('before').$type<unknown>(),
    after: jsonb('after').$type<unknown>(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_guild_created_idx').on(t.guildId, sql`${t.createdAt} desc`),
    index('audit_logs_guild_actor_idx').on(t.guildId, t.actorId),
  ],
);
