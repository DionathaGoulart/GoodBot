import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { reminders } from '../schema/misc';

import type { DbExecutor } from '../client';
import type { NewReminder, Reminder } from '../types';

export type CreateReminderInput = Omit<NewReminder, 'id' | 'createdAt' | 'doneAt'>;

export async function createReminder(
  db: DbExecutor,
  input: CreateReminderInput,
): Promise<Reminder> {
  const [row] = await db.insert(reminders).values(input).returning();
  if (!row) throw new Error('INSERT em reminders não retornou linha');
  return row;
}

/** Lembretes pendentes de um usuário, do mais próximo ao mais distante. */
export async function listPendingReminders(
  db: DbExecutor,
  guildId: string,
  userId: string,
): Promise<Reminder[]> {
  return db
    .select()
    .from(reminders)
    .where(
      and(eq(reminders.guildId, guildId), eq(reminders.userId, userId), isNull(reminders.doneAt)),
    )
    .orderBy(asc(reminders.runAt));
}

export async function countPendingReminders(
  db: DbExecutor,
  guildId: string,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(reminders)
    .where(
      and(eq(reminders.guildId, guildId), eq(reminders.userId, userId), isNull(reminders.doneAt)),
    );
  return Number(row?.total ?? 0);
}

export async function getReminder(db: DbExecutor, id: number): Promise<Reminder | null> {
  const [row] = await db.select().from(reminders).where(eq(reminders.id, id)).limit(1);
  return row ?? null;
}

/**
 * Marca como entregue. Devolve `null` quando alguém já cancelou ou entregou —
 * o scheduler usa isso para não mandar a mesma DM duas vezes.
 */
export async function completeReminder(db: DbExecutor, id: number): Promise<Reminder | null> {
  const [row] = await db
    .update(reminders)
    .set({ doneAt: sql`now()` })
    .where(and(eq(reminders.id, id), isNull(reminders.doneAt)))
    .returning();
  return row ?? null;
}

/** Cancelamento pelo dono (`/remind cancel`); só apaga o que é dele. */
export async function cancelReminder(
  db: DbExecutor,
  input: { guildId: string; userId: string; id: number },
): Promise<Reminder | null> {
  const [row] = await db
    .update(reminders)
    .set({ doneAt: sql`now()` })
    .where(
      and(
        eq(reminders.id, input.id),
        eq(reminders.guildId, input.guildId),
        eq(reminders.userId, input.userId),
        isNull(reminders.doneAt),
      ),
    )
    .returning();
  return row ?? null;
}
