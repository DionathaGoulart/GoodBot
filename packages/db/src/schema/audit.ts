import { sql } from 'drizzle-orm';
import { bigserial, index, jsonb, pgTable } from 'drizzle-orm/pg-core';

import { createdAt, snowflake, text } from './_columns';
import { auditSourceEnum } from './enums';
import { guilds } from './guilds';

/**
 * Auditoria — append-only (PRD §6.5). Desde a Etapa 22 ela não é só do painel:
 * `source` diz de onde a ação veio (painel, comando, automod, evento, job) e
 * `reason` guarda o porquê quando existe um — o motivo da punição, o nome da
 * regra que disparou, a conta que publicou.
 */
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
    /** De onde veio a ação. Default `dashboard`: é o que as linhas antigas são. */
    source: auditSourceEnum('source').notNull().default('dashboard'),
    /** Texto livre do porquê; `null` quando a ação não tem um. */
    reason: text('reason'),
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
    index('audit_logs_guild_source_created_idx').on(t.guildId, t.source, sql`${t.createdAt} desc`),
  ],
);
