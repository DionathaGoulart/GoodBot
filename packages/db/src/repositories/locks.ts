import { and, eq } from 'drizzle-orm';

import { channelLocks } from '../schema/misc';

import type { DbExecutor } from '../client';
import type { ChannelLock, NewChannelLock } from '../types';

export type CreateChannelLockInput = Omit<NewChannelLock, 'id' | 'createdAt'>;

/**
 * Grava o lock de um canal. Um `/lock` sobre um canal já trancado **não**
 * sobrescreve o snapshot: os overwrites guardados são os de antes do primeiro
 * lock, e são eles que o `/unlock` precisa restaurar.
 */
export async function saveChannelLock(
  db: DbExecutor,
  input: CreateChannelLockInput,
): Promise<ChannelLock | null> {
  const [row] = await db
    .insert(channelLocks)
    .values(input)
    .onConflictDoNothing({ target: [channelLocks.guildId, channelLocks.channelId] })
    .returning();
  return row ?? null;
}

export async function getChannelLock(
  db: DbExecutor,
  guildId: string,
  channelId: string,
): Promise<ChannelLock | null> {
  const [row] = await db
    .select()
    .from(channelLocks)
    .where(and(eq(channelLocks.guildId, guildId), eq(channelLocks.channelId, channelId)))
    .limit(1);
  return row ?? null;
}

export async function listChannelLocks(
  db: DbExecutor,
  guildId: string,
): Promise<ChannelLock[]> {
  return db.select().from(channelLocks).where(eq(channelLocks.guildId, guildId));
}

/** Remove e devolve o lock — o chamador usa o snapshot para restaurar. */
export async function deleteChannelLock(
  db: DbExecutor,
  guildId: string,
  channelId: string,
): Promise<ChannelLock | null> {
  const [row] = await db
    .delete(channelLocks)
    .where(and(eq(channelLocks.guildId, guildId), eq(channelLocks.channelId, channelId)))
    .returning();
  return row ?? null;
}
