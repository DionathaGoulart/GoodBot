import { sql } from 'drizzle-orm';
import { bigserial, boolean, index, jsonb, pgTable, uuid } from 'drizzle-orm/pg-core';

import { createdAt, snowflake, text, timestamptz, updatedAt } from './_columns';
import { guilds } from './guilds';

export const reminders = pgTable(
  'reminders',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: snowflake('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userId: snowflake('user_id').notNull(),
    /** `null` = enviar por DM. */
    channelId: snowflake('channel_id'),
    text: text('text').notNull(),
    runAt: timestamptz('run_at').notNull(),
    doneAt: timestamptz('done_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('reminders_pending_idx')
      .on(t.runAt)
      .where(sql`${t.doneAt} is null`),
    index('reminders_guild_user_idx').on(t.guildId, t.userId),
  ],
);

export interface PollOption {
  id: string;
  label: string;
  emoji?: string;
}

/** `userId → índices/ids das opções escolhidas`. */
export type PollVotes = Record<string, string[]>;

export const polls = pgTable(
  'polls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: snowflake('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    channelId: snowflake('channel_id').notNull(),
    messageId: snowflake('message_id'),
    authorId: snowflake('author_id').notNull(),
    question: text('question').notNull(),
    options: jsonb('options').$type<PollOption[]>().notNull(),
    multiple: boolean('multiple').notNull().default(false),
    endsAt: timestamptz('ends_at').notNull(),
    closedAt: timestamptz('closed_at'),
    votes: jsonb('votes').$type<PollVotes>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('polls_open_idx')
      .on(t.endsAt)
      .where(sql`${t.closedAt} is null`),
    index('polls_message_idx').on(t.messageId),
  ],
);

/** Pares chave/valor: hash do manifesto de comandos, versão de schema etc. */
export const meta = pgTable('meta', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});
