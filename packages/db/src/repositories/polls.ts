import { and, eq, isNull, sql } from 'drizzle-orm';

import { polls } from '../schema/misc';

import type { Db, DbExecutor } from '../client';
import type { NewPoll, Poll } from '../types';

export type CreatePollInput = Omit<NewPoll, 'id' | 'createdAt' | 'closedAt' | 'votes'>;

export async function createPoll(db: DbExecutor, input: CreatePollInput): Promise<Poll> {
  const [row] = await db
    .insert(polls)
    .values({ ...input, votes: {} })
    .returning();
  if (!row) throw new Error('INSERT em polls não retornou linha');
  return row;
}

/** A mensagem só existe depois do insert: o custom id dos botões usa o id da enquete. */
export async function setPollMessage(
  db: DbExecutor,
  id: string,
  messageId: string,
): Promise<void> {
  await db.update(polls).set({ messageId }).where(eq(polls.id, id));
}

export async function getPoll(db: DbExecutor, id: string): Promise<Poll | null> {
  const [row] = await db.select().from(polls).where(eq(polls.id, id)).limit(1);
  return row ?? null;
}

export async function listOpenPolls(db: DbExecutor, guildId: string): Promise<Poll[]> {
  return db
    .select()
    .from(polls)
    .where(and(eq(polls.guildId, guildId), isNull(polls.closedAt)))
    .orderBy(polls.endsAt);
}

export type VoteResult =
  | { status: 'ok'; poll: Poll; chosen: string[] }
  | { status: 'closed' }
  | { status: 'unknown' };

/**
 * Registra (ou desfaz) o voto de um usuário. A leitura e a escrita do jsonb
 * ficam numa transação com `for update`: dois cliques simultâneos no mesmo
 * botão perderiam um voto se cada um lesse o mapa antes do outro gravar.
 */
export async function votePoll(
  db: Db,
  input: { pollId: string; userId: string; optionId: string },
): Promise<VoteResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(polls)
      .where(eq(polls.id, input.pollId))
      .limit(1)
      .for('update');
    if (!row) return { status: 'unknown' };
    if (row.closedAt || row.endsAt.getTime() <= Date.now()) return { status: 'closed' };
    if (!row.options.some((option) => option.id === input.optionId)) return { status: 'unknown' };

    const current = row.votes[input.userId] ?? [];
    let chosen: string[];
    if (row.multiple) {
      // Clicar de novo tira o voto daquela opção; as outras continuam.
      chosen = current.includes(input.optionId)
        ? current.filter((id) => id !== input.optionId)
        : [...current, input.optionId];
    } else {
      chosen = current.includes(input.optionId) ? [] : [input.optionId];
    }

    const votes = { ...row.votes };
    if (chosen.length > 0) votes[input.userId] = chosen;
    else delete votes[input.userId];

    const [updated] = await tx
      .update(polls)
      .set({ votes })
      .where(eq(polls.id, input.pollId))
      .returning();
    if (!updated) throw new Error('UPDATE em polls não retornou linha');
    return { status: 'ok', poll: updated, chosen };
  });
}

/**
 * Fecha a enquete. Devolve `null` se ela já estava fechada — o `poll_close`
 * do scheduler e um `/poll end` manual podem correr juntos.
 */
export async function closePoll(db: DbExecutor, id: string): Promise<Poll | null> {
  const [row] = await db
    .update(polls)
    .set({ closedAt: sql`now()` })
    .where(and(eq(polls.id, id), isNull(polls.closedAt)))
    .returning();
  return row ?? null;
}
