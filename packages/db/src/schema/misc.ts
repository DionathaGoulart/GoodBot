import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  jsonb,
  pgTable,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, snowflake, snowflakeArray, text, timestamptz, updatedAt } from './_columns';
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

/**
 * Snapshot de um permission overwrite antes do `/lock`. `allow`/`deny` são
 * bitfields em string porque o Discord passa de 2^53 e `Number` perderia bits.
 */
export interface LockOverwrite {
  id: string;
  /** `OverwriteType`: 0 = cargo, 1 = membro. */
  type: number;
  allow: string;
  deny: string;
}

/**
 * Um canal trancado por vez (`/lock`, `/lockdown`). Guarda os overwrites
 * anteriores para o `/unlock` restaurar exatamente o que existia — sem isto
 * um unlock devolveria `SendMessages` a quem nunca teve.
 */
export const channelLocks = pgTable(
  'channel_locks',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: snowflake('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    channelId: snowflake('channel_id').notNull(),
    /** Ids afetados pelo lock (`@everyone` + `extraRoleIds`). */
    roleIds: snowflakeArray('role_ids'),
    /** Overwrites que esses ids tinham antes; ausente = não tinha nenhum. */
    overwrites: jsonb('overwrites').$type<LockOverwrite[]>().notNull().default([]),
    lockedBy: snowflake('locked_by').notNull(),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('channel_locks_channel_uidx').on(t.guildId, t.channelId),
    index('channel_locks_guild_idx').on(t.guildId),
  ],
);
