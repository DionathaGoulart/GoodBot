import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';

import { cases, scheduledActions } from '../schema/cases';

import type { Db, DbExecutor } from '../client';
import type { Case, NewCase, NewScheduledAction, ScheduledAction } from '../types';

export type CreateCaseInput = Omit<
  NewCase,
  'id' | 'caseNumber' | 'createdAt' | 'editedAt' | 'editedBy' | 'deletedAt'
>;

/** Código do Postgres para violação de unique (`cases_guild_number_uidx`). */
const UNIQUE_VIOLATION = '23505';
const MAX_ATTEMPTS = 5;

/** O Drizzle embrulha o `PostgresError` em `DrizzleQueryError`; o código fica em `cause`. */
function isUniqueViolation(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    if (typeof current !== 'object') return false;
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Insere um caso com `case_number = max + 1` por guild, em transação. Um
 * advisory lock por guild serializa inserções concorrentes; se mesmo assim o
 * índice único reclamar, a inserção é repetida (até 5 vezes).
 */
export async function createCase(db: Db, input: CreateCaseInput): Promise<Case> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.guildId}))`);
        const [row] = await tx
          .insert(cases)
          .values({
            ...input,
            caseNumber: sql<number>`(
              select coalesce(max(${cases.caseNumber}), 0) + 1
              from ${cases}
              where ${cases.guildId} = ${input.guildId}
            )`,
          })
          .returning();
        if (!row) throw new Error('INSERT em cases não retornou linha');
        return row;
      });
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= MAX_ATTEMPTS) throw error;
    }
  }
}

/** Próximo número de caso da guild (informativo; `createCase` é atômico). */
export async function nextCaseNumber(db: DbExecutor, guildId: string): Promise<number> {
  const [row] = await db
    .select({ next: sql<number>`coalesce(max(${cases.caseNumber}), 0) + 1` })
    .from(cases)
    .where(eq(cases.guildId, guildId));
  return Number(row?.next ?? 1);
}

/** Busca por número (ignora soft-deleted por padrão). */
export async function getCaseByNumber(
  db: DbExecutor,
  guildId: string,
  caseNumber: number,
  options: { includeDeleted?: boolean } = {},
): Promise<Case | null> {
  const conditions = [eq(cases.guildId, guildId), eq(cases.caseNumber, caseNumber)];
  if (!options.includeDeleted) conditions.push(isNull(cases.deletedAt));
  const [row] = await db
    .select()
    .from(cases)
    .where(and(...conditions))
    .limit(1);
  return row ?? null;
}

/** Histórico paginado de um usuário (mais recentes primeiro). */
export async function listCasesForTarget(
  db: DbExecutor,
  guildId: string,
  targetId: string,
  options: { type?: Case['type']; limit?: number; offset?: number } = {},
): Promise<Case[]> {
  const conditions = [
    eq(cases.guildId, guildId),
    eq(cases.targetId, targetId),
    isNull(cases.deletedAt),
  ];
  if (options.type) conditions.push(eq(cases.type, options.type));
  return db
    .select()
    .from(cases)
    .where(and(...conditions))
    .orderBy(desc(cases.createdAt))
    .limit(options.limit ?? 10)
    .offset(options.offset ?? 0);
}

/** Total de casos de um usuário — o `/history` usa para calcular as páginas. */
export async function countCasesForTarget(
  db: DbExecutor,
  guildId: string,
  targetId: string,
  options: { type?: Case['type'] } = {},
): Promise<number> {
  const conditions = [
    eq(cases.guildId, guildId),
    eq(cases.targetId, targetId),
    isNull(cases.deletedAt),
  ];
  if (options.type) conditions.push(eq(cases.type, options.type));
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(cases)
    .where(and(...conditions));
  return Number(row?.total ?? 0);
}

/** Contagem por tipo de caso de um alvo — o resumo do `/userinfo`. */
export async function countCasesByType(
  db: DbExecutor,
  guildId: string,
  targetId: string,
): Promise<Partial<Record<Case['type'], number>>> {
  const rows = await db
    .select({ type: cases.type, total: sql<number>`count(*)` })
    .from(cases)
    .where(
      and(eq(cases.guildId, guildId), eq(cases.targetId, targetId), isNull(cases.deletedAt)),
    )
    .groupBy(cases.type);
  return Object.fromEntries(rows.map((row) => [row.type, Number(row.total)]));
}

/** Warns de um usuário desde um instante — base da escalada (PRD §5.1). */
export async function countWarnsSince(
  db: DbExecutor,
  guildId: string,
  targetId: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(cases)
    .where(
      and(
        eq(cases.guildId, guildId),
        eq(cases.targetId, targetId),
        eq(cases.type, 'warn'),
        isNull(cases.deletedAt),
        gte(cases.createdAt, since),
      ),
    );
  return Number(row?.total ?? 0);
}

/** Edita o motivo (`/case edit`, `/reason`) e registra quem editou. */
export async function updateCaseReason(
  db: DbExecutor,
  guildId: string,
  caseNumber: number,
  input: { reason: string; editedBy: string },
): Promise<Case | null> {
  const [row] = await db
    .update(cases)
    .set({ reason: input.reason, editedBy: input.editedBy, editedAt: sql`now()` })
    .where(
      and(eq(cases.guildId, guildId), eq(cases.caseNumber, caseNumber), isNull(cases.deletedAt)),
    )
    .returning();
  return row ?? null;
}

/** Soft delete (`/case delete`, só admin). O caso nunca sai da tabela. */
export async function softDeleteCase(
  db: DbExecutor,
  guildId: string,
  caseNumber: number,
): Promise<Case | null> {
  const [row] = await db
    .update(cases)
    .set({ deletedAt: sql`now()` })
    .where(
      and(eq(cases.guildId, guildId), eq(cases.caseNumber, caseNumber), isNull(cases.deletedAt)),
    )
    .returning();
  return row ?? null;
}

/** Guarda onde o caso foi publicado no mod-log, para editar depois (Etapa 5). */
export async function setCaseModlogMessage(
  db: DbExecutor,
  caseId: number,
  channelId: string,
  messageId: string,
): Promise<void> {
  await db
    .update(cases)
    .set({ modlogChannelId: channelId, modlogMessageId: messageId })
    .where(eq(cases.id, caseId));
}

// ── scheduled_actions ───────────────────────────────────────────────────────

export type ScheduleActionInput = Omit<NewScheduledAction, 'id' | 'createdAt' | 'doneAt'>;

export async function scheduleAction(
  db: DbExecutor,
  input: ScheduleActionInput,
): Promise<ScheduledAction> {
  const [row] = await db.insert(scheduledActions).values(input).returning();
  if (!row) throw new Error('INSERT em scheduled_actions não retornou linha');
  return row;
}

/**
 * Toma as ações vencidas para execução. O `for update skip locked` deixa dois
 * processos rodarem o scheduler sem executar a mesma ação duas vezes, e o
 * `done_at` é gravado **na tomada** (não depois de falar com o Discord): uma
 * ação que falha vira log, e não uma tentativa repetida a cada 30 s para
 * sempre.
 */
export async function claimDueActions(
  db: Db,
  options: { limit?: number; now?: Date; kinds?: readonly ScheduledAction['kind'][] } = {},
): Promise<ScheduledAction[]> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const conditions = [isNull(scheduledActions.doneAt), lte(scheduledActions.runAt, now)];
    if (options.kinds?.length) {
      conditions.push(inArray(scheduledActions.kind, [...options.kinds]));
    }
    const due = await tx
      .select({ id: scheduledActions.id })
      .from(scheduledActions)
      .where(and(...conditions))
      .orderBy(scheduledActions.runAt)
      .limit(options.limit ?? 25)
      .for('update', { skipLocked: true });

    if (due.length === 0) return [];

    return tx
      .update(scheduledActions)
      .set({ doneAt: now })
      .where(
        inArray(
          scheduledActions.id,
          due.map((row) => row.id),
        ),
      )
      .returning();
  });
}

/**
 * Cancela ações pendentes de um alvo — um `/unban` manual antes do tempban
 * expirar não pode deixar um `unban` agendado para ninguém.
 */
export async function cancelScheduledActions(
  db: DbExecutor,
  input: { guildId: string; kind: ScheduledAction['kind']; targetId: string },
): Promise<number> {
  const rows = await db
    .update(scheduledActions)
    .set({ doneAt: sql`now()` })
    .where(
      and(
        eq(scheduledActions.guildId, input.guildId),
        eq(scheduledActions.kind, input.kind),
        isNull(scheduledActions.doneAt),
        sql`${scheduledActions.payload} ->> 'targetId' = ${input.targetId}`,
      ),
    )
    .returning({ id: scheduledActions.id });
  return rows.length;
}
