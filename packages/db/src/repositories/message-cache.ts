import { and, eq, inArray, lt, sql } from 'drizzle-orm';

import { messageCache } from '../schema/messages';

import type { DbExecutor } from '../client';
import type { CachedMessage } from '../types';
import type { InferInsertModel } from 'drizzle-orm';

export type CacheMessageInput = Omit<InferInsertModel<typeof messageCache>, 'createdAt'> & {
  createdAt?: Date;
};

/**
 * Grava um lote de mensagens. Reenvio do mesmo id (uma edição chegando junto
 * do create) atualiza o conteúdo em vez de estourar o primary key.
 */
export async function cacheMessages(db: DbExecutor, rows: CacheMessageInput[]): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(messageCache)
    .values(rows)
    .onConflictDoUpdate({
      target: messageCache.messageId,
      set: {
        content: sql`excluded.content`,
        attachments: sql`excluded.attachments`,
      },
    })
    .returning({ messageId: messageCache.messageId });
  return inserted.length;
}

/** Conteúdo de uma mensagem que o discord.js não tinha no cache. */
export async function getCachedMessage(
  db: DbExecutor,
  messageId: string,
): Promise<CachedMessage | null> {
  const [row] = await db
    .select()
    .from(messageCache)
    .where(eq(messageCache.messageId, messageId))
    .limit(1);
  return row ?? null;
}

/** Usado pelo log de bulk delete, que recupera dezenas de mensagens de uma vez. */
export async function getCachedMessages(
  db: DbExecutor,
  messageIds: readonly string[],
): Promise<CachedMessage[]> {
  if (messageIds.length === 0) return [];
  return db
    .select()
    .from(messageCache)
    .where(inArray(messageCache.messageId, [...messageIds]));
}

/** Job de retenção: apaga o que passou de `MESSAGE_CACHE_RETENTION_DAYS`. */
export async function deleteCachedMessagesBefore(db: DbExecutor, before: Date): Promise<number> {
  const rows = await db
    .delete(messageCache)
    .where(lt(messageCache.createdAt, before))
    .returning({ messageId: messageCache.messageId });
  return rows.length;
}

/** Limpeza pontual de um canal (usada quando o canal é apagado). */
export async function deleteCachedMessagesForChannel(
  db: DbExecutor,
  guildId: string,
  channelId: string,
): Promise<number> {
  const rows = await db
    .delete(messageCache)
    .where(and(eq(messageCache.guildId, guildId), eq(messageCache.channelId, channelId)))
    .returning({ messageId: messageCache.messageId });
  return rows.length;
}
