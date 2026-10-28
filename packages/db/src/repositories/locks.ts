import { and, eq, isNull, lte, sql } from 'drizzle-orm';

import { withDbEffectPermit } from './cases';
import { scheduledActions } from '../schema/cases';
import { channelLocks } from '../schema/misc';

import type { Db, DbExecutor } from '../client';
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

export async function markChannelLockApplied(db: DbExecutor, id: number): Promise<void> {
  const [row] = await db
    .update(channelLocks)
    .set({ appliedAt: sql`now()` })
    .where(eq(channelLocks.id, id))
    .returning({ id: channelLocks.id });
  if (!row) throw new Error('Lock alterado antes da confirmação');
}

export async function listChannelLocks(db: DbExecutor, guildId: string): Promise<ChannelLock[]> {
  return db.select().from(channelLocks).where(eq(channelLocks.guildId, guildId));
}

/** Reserva abandonada: nunca restaurar automaticamente sem confirmar aplicação. */
export async function listStalePendingChannelLocks(
  db: DbExecutor,
  olderThan: Date,
): Promise<ChannelLock[]> {
  return db
    .select()
    .from(channelLocks)
    .where(and(isNull(channelLocks.appliedAt), lte(channelLocks.createdAt, olderThan)))
    .limit(1000);
}

/** Serializa lock/unlock do mesmo canal, inclusive chamadas de outros workers. */
export async function withChannelLock<T>(
  db: Db,
  guildId: string,
  channelId: string,
  action: (tx: DbExecutor) => Promise<T>,
): Promise<T> {
  return withDbEffectPermit(db, () =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('goodbot:channel-lock'), hashtext(${`${guildId}:${channelId}`}))`,
      );
      return action(tx);
    }),
  );
}

/** Remove e devolve o lock — o chamador usa o snapshot para restaurar. */
export async function deleteChannelLock(
  db: DbExecutor,
  guildId: string,
  channelId: string,
  id?: number,
): Promise<ChannelLock | null> {
  const conditions = [eq(channelLocks.guildId, guildId), eq(channelLocks.channelId, channelId)];
  if (id !== undefined) conditions.push(eq(channelLocks.id, id));
  const [row] = await db
    .delete(channelLocks)
    .where(and(...conditions))
    .returning();
  return row ?? null;
}

/** Ao encerrar um lock, não deixar seu unlock agendado atingir outro lock. */
export async function cancelScheduledChannelUnlocks(
  db: DbExecutor,
  guildId: string,
  channelId: string,
  lockId: number,
): Promise<number> {
  const rows = await db
    .update(scheduledActions)
    .set({ doneAt: sql`now()`, leaseUntil: null, claimToken: null })
    .where(
      and(
        eq(scheduledActions.guildId, guildId),
        eq(scheduledActions.kind, 'unlock'),
        isNull(scheduledActions.doneAt),
        sql`${scheduledActions.payload} ->> 'channelId' = ${channelId}`,
        sql`${scheduledActions.payload} ->> 'lockId' = ${String(lockId)}`,
      ),
    )
    .returning({ id: scheduledActions.id });
  return rows.length;
}
