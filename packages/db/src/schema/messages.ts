import { index, jsonb, pgTable } from 'drizzle-orm/pg-core';

import { createdAt, snowflake, text } from './_columns';
import { guilds } from './guilds';

export interface CachedAttachment {
  name: string;
  size: number;
  contentType: string | null;
}

/**
 * Cache de mensagens para recuperar conteúdo em `messageDelete`. Só com o
 * módulo de logs ativo; retenção de 7 dias (job do bot).
 */
export const messageCache = pgTable(
  'message_cache',
  {
    messageId: snowflake('message_id').primaryKey(),
    guildId: snowflake('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    channelId: snowflake('channel_id').notNull(),
    authorId: snowflake('author_id').notNull(),
    content: text('content').notNull().default(''),
    attachments: jsonb('attachments').$type<CachedAttachment[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [
    index('message_cache_guild_channel_idx').on(t.guildId, t.channelId),
    index('message_cache_created_idx').on(t.createdAt),
  ],
);
