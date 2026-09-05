import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { cases } from '../schema/cases';

import type { Db, DbExecutor } from '../client';
import type { Case, NewCase } from '../types';

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
