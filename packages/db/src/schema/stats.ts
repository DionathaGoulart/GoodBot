import { bigint, index, pgTable, primaryKey } from 'drizzle-orm/pg-core';

import { snowflake, text, timestamptz } from './_columns';
import { statGranularityEnum, statKindEnum } from './enums';
import { guilds } from './guilds';

/**
 * Buckets agregados (PRD §5.6). `key` depende do `kind` (id de canal/usuário,
 * tipo de caso, nome de comando, id de regra; `'_'` quando não se aplica).
 * Nenhum conteúdo de mensagem é armazenado.
 */
export const statBuckets = pgTable(
  'stat_buckets',
  {
    guildId: snowflake('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    kind: statKindEnum('kind').notNull(),
    key: text('key').notNull().default('_'),
    bucketStart: timestamptz('bucket_start').notNull(),
    granularity: statGranularityEnum('granularity').notNull().default('hour'),
    count: bigint('count', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.guildId, t.kind, t.key, t.bucketStart, t.granularity] }),
    index('stat_buckets_guild_kind_start_idx').on(t.guildId, t.kind, t.bucketStart),
  ],
);
