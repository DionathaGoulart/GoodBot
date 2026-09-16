import { count, getTableName, sql } from 'drizzle-orm';

import { messageCache } from '../schema/messages';

import type { DbExecutor } from '../client';

/**
 * Leituras de capacidade: quanto o banco ocupa e quem ocupa.
 *
 * Como `usageByGuild`, as duas cruzam servidores de propósito e só servem ao
 * painel do dono do bot e ao `CapacityJob`. Nenhuma tela de servidor chama
 * isto.
 */

export interface StorageUsage {
  /** O banco inteiro: é este número que o Supabase compara com a cota. */
  databaseBytes: number;
  /** `message_cache` com índices, o que mais cresce com o tráfego. */
  messageCacheBytes: number;
}

export async function getStorageUsage(db: DbExecutor): Promise<StorageUsage> {
  // `float8` e não `bigint`: o postgres-js devolve `int8` como texto, e os dois
  // números cabem com folga na precisão de um `number`.
  const rows = await db.execute<{ database: number; message_cache: number }>(sql`
    select
      pg_database_size(current_database())::float8 as database,
      pg_total_relation_size(${getTableName(messageCache)}::regclass)::float8 as message_cache
  `);
  const row = rows[0];
  return { databaseBytes: row?.database ?? 0, messageCacheBytes: row?.message_cache ?? 0 };
}

export interface MessageCacheUsageRow {
  guildId: string;
  /** Mensagens guardadas agora, ou seja, nos últimos 7 dias (a retenção). */
  messages: number;
}

/** Quantas mensagens cada servidor tem no `message_cache`. */
export async function messageCacheByGuild(db: DbExecutor): Promise<MessageCacheUsageRow[]> {
  return db
    .select({ guildId: messageCache.guildId, messages: count() })
    .from(messageCache)
    .groupBy(messageCache.guildId);
}
