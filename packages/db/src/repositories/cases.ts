import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';

import { isUniqueViolation } from './pg-errors';
import { cases, scheduledActions } from '../schema/cases';

import type { Db, DbExecutor } from '../client';
import type { Case, NewCase, NewScheduledAction, ScheduledAction } from '../types';
import type { SQL } from 'drizzle-orm';

export type CreateCaseInput = Omit<
  NewCase,
  'id' | 'caseNumber' | 'createdAt' | 'editedAt' | 'editedBy' | 'deletedAt'
>;

/** Tentativas quando `cases_guild_number_uidx` reclama. */
const MAX_ATTEMPTS = 5;

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
    .where(and(eq(cases.guildId, guildId), eq(cases.targetId, targetId), isNull(cases.deletedAt)))
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

export type ScheduleActionInput = Omit<
  NewScheduledAction,
  | 'id'
  | 'createdAt'
  | 'doneAt'
  | 'leaseUntil'
  | 'claimToken'
  | 'attempts'
  | 'failedAt'
  | 'lastError'
>;

export async function scheduleAction(
  db: DbExecutor,
  input: ScheduleActionInput,
): Promise<ScheduledAction> {
  const [row] = await db.insert(scheduledActions).values(input).returning();
  if (!row) throw new Error('INSERT em scheduled_actions não retornou linha');
  return row;
}

/** Versão durável de uma punição; concluída de imediato, nunca entra no scheduler. */
export async function recordPunishmentTransition(
  db: DbExecutor,
  input: {
    guildId: string;
    caseId?: number;
    kind: 'unban' | 'untimeout';
    targetId: string;
    fallbackActionIds?: number[];
  },
): Promise<number> {
  await db
    .update(scheduledActions)
    .set({
      payload: sql`jsonb_set(${scheduledActions.payload}, '{transitionState}', '"superseded"'::jsonb)`,
    })
    .where(
      and(
        eq(scheduledActions.guildId, input.guildId),
        eq(scheduledActions.kind, input.kind),
        sql`${scheduledActions.payload} ->> 'targetId' = ${input.targetId}`,
        sql`${scheduledActions.payload} ->> 'transitionState' = 'prepared'`,
      ),
    );
  const [row] = await db
    .insert(scheduledActions)
    .values({
      guildId: input.guildId,
      caseId: input.caseId ?? null,
      kind: input.kind,
      runAt: new Date(),
      payload: {
        targetId: input.targetId,
        transitionMarker: true,
        transitionState: 'prepared',
        fallbackActionIds: input.fallbackActionIds ?? [],
      },
      doneAt: new Date(),
    })
    .returning({ id: scheduledActions.id });
  if (!row) throw new Error('INSERT do marcador de punição não retornou linha');
  return row.id;
}

/** A geração mais nova vence se duas requisições prepararam antes do REST. */
export async function isCurrentPunishmentTransition(
  db: DbExecutor,
  input: {
    guildId: string;
    kind: 'unban' | 'untimeout';
    targetId: string;
    markerId: number;
    expectedState?: 'attempting';
  },
): Promise<boolean> {
  const [row] = await db
    .select({
      id: scheduledActions.id,
      payload: scheduledActions.payload,
      failedAt: scheduledActions.failedAt,
    })
    .from(scheduledActions)
    .where(
      and(
        eq(scheduledActions.guildId, input.guildId),
        eq(scheduledActions.kind, input.kind),
        sql`${scheduledActions.payload} ->> 'targetId' = ${input.targetId}`,
        sql`${scheduledActions.payload} ->> 'transitionMarker' = 'true'`,
      ),
    )
    .orderBy(desc(scheduledActions.id))
    .limit(1);
  return (
    row?.id === input.markerId &&
    (!input.expectedState ||
      (row.payload.transitionState === input.expectedState && row.failedAt === null))
  );
}

export async function markPunishmentTransitionApplied(
  db: DbExecutor,
  markerId: number,
): Promise<void> {
  return setPunishmentTransitionState(db, markerId, 'applied');
}

/** Ponto durável a partir do qual um crash pode ter aplicado REST. */
export async function markPunishmentTransitionAttempting(
  db: DbExecutor,
  markerId: number,
): Promise<boolean> {
  const [row] = await db
    .update(scheduledActions)
    .set({
      payload: sql`jsonb_set(${scheduledActions.payload}, '{transitionState}', '"attempting"'::jsonb)`,
    })
    .where(
      and(
        eq(scheduledActions.id, markerId),
        sql`${scheduledActions.payload} ->> 'transitionState' = 'prepared'`,
        isNull(scheduledActions.failedAt),
      ),
    )
    .returning({ id: scheduledActions.id });
  return Boolean(row);
}

export async function markPunishmentTransitionRejected(
  db: DbExecutor,
  markerId: number,
): Promise<void> {
  return setPunishmentTransitionState(db, markerId, 'rejected');
}

async function setPunishmentTransitionState(
  db: DbExecutor,
  markerId: number,
  state: 'applied' | 'rejected',
): Promise<void> {
  await db
    .update(scheduledActions)
    .set({
      payload: sql`jsonb_set(${scheduledActions.payload}, '{transitionState}', ${JSON.stringify(state)}::jsonb)`,
    })
    .where(eq(scheduledActions.id, markerId));
}

/** Estado ambíguo exige reconciliação manual; nunca desfaz às cegas. */
export async function markPunishmentTransitionUncertain(
  db: DbExecutor,
  markerId: number,
  newActionId: number | undefined,
  error: string,
): Promise<void> {
  await db
    .update(scheduledActions)
    .set({ failedAt: sql`now()`, lastError: error.slice(0, 500) })
    .where(eq(scheduledActions.id, markerId));
  if (newActionId !== undefined) {
    await db
      .update(scheduledActions)
      .set({ failedAt: sql`now()`, lastError: error.slice(0, 500) })
      .where(and(eq(scheduledActions.id, newActionId), isNull(scheduledActions.doneAt)));
  }
}

/** Quedas sem catch deixam marker prepared/attempting: terminalizar sob mutex. */
export async function markStalePunishmentTransitions(
  db: Db,
  now = new Date(),
): Promise<Array<{ id: number; guildId: string; payload: Record<string, unknown> }>> {
  const cutoff = new Date(now.getTime() - 10 * 60_000);
  const candidates = await db
    .select({
      id: scheduledActions.id,
      guildId: scheduledActions.guildId,
      kind: scheduledActions.kind,
      payload: scheduledActions.payload,
    })
    .from(scheduledActions)
    .where(
      and(
        sql`${scheduledActions.payload} ->> 'transitionMarker' = 'true'`,
        sql`${scheduledActions.payload} ->> 'transitionState' in ('prepared', 'attempting')`,
        isNull(scheduledActions.failedAt),
        lte(scheduledActions.createdAt, cutoff),
      ),
    )
    .limit(100);
  const stale: Array<{ id: number; guildId: string; payload: Record<string, unknown> }> = [];
  for (const candidate of candidates) {
    if (
      (candidate.kind !== 'unban' && candidate.kind !== 'untimeout') ||
      typeof candidate.payload.targetId !== 'string'
    )
      continue;
    const marked = await withPunishmentLock(
      db,
      candidate.guildId,
      candidate.kind,
      candidate.payload.targetId,
      async (tx) => {
        const [row] = await tx
          .update(scheduledActions)
          .set({
            failedAt: now,
            lastError: 'Transição sem confirmação; reconciliação necessária',
          })
          .where(
            and(
              eq(scheduledActions.id, candidate.id),
              sql`${scheduledActions.payload} ->> 'transitionState' in ('prepared', 'attempting')`,
              isNull(scheduledActions.failedAt),
              lte(scheduledActions.createdAt, cutoff),
            ),
          )
          .returning({
            id: scheduledActions.id,
            guildId: scheduledActions.guildId,
            payload: scheduledActions.payload,
          });
        if (!row) return null;
        await tx
          .update(scheduledActions)
          .set({
            failedAt: now,
            lastError: 'Punição com estado Discord incerto; reconciliação necessária',
          })
          .where(
            and(
              sql`${scheduledActions.payload} ->> 'transitionMarkerId' = ${String(row.id)}`,
              isNull(scheduledActions.doneAt),
            ),
          );
        return row;
      },
    );
    if (marked) stale.push(marked);
  }
  return stale;
}

/** Fora da janela curta do nonce, reenviar lembrete pode duplicar mensagem. */
export async function markStaleReminderDeliveries(
  db: DbExecutor,
  now = new Date(),
): Promise<Array<{ id: number; guildId: string; payload: Record<string, unknown> }>> {
  return db
    .update(scheduledActions)
    .set({
      failedAt: now,
      lastError: 'Entrega do lembrete incerta; verificar destino antes de reenviar',
    })
    .where(
      and(
        eq(scheduledActions.kind, 'reminder'),
        isNull(scheduledActions.doneAt),
        isNull(scheduledActions.failedAt),
        lte(scheduledActions.leaseUntil, now),
        sql`${scheduledActions.payload} ? 'firstSendAttemptAt'`,
        sql`(${scheduledActions.payload} ->> 'firstSendAttemptAt')::timestamptz <= ${new Date(now.getTime() - 2 * 60_000).toISOString()}::timestamptz`,
      ),
    )
    .returning({
      id: scheduledActions.id,
      guildId: scheduledActions.guildId,
      payload: scheduledActions.payload,
    });
}

/** Confirma intenção de envio antes do REST; falha de DB impede duplicação incerta. */
export async function markReminderSendAttempt(
  db: DbExecutor,
  id: number,
  claimToken: string,
  now = new Date(),
): Promise<'ready' | 'uncertain' | 'superseded'> {
  const cutoff = new Date(now.getTime() - 2 * 60_000).toISOString();
  const [row] = await db
    .update(scheduledActions)
    .set({
      payload: sql`case when ${scheduledActions.payload} ? 'firstSendAttemptAt'
        then ${scheduledActions.payload}
        else jsonb_set(${scheduledActions.payload}, '{firstSendAttemptAt}', to_jsonb(${now.toISOString()}::text)) end`,
      failedAt: sql`case when (${scheduledActions.payload} ->> 'firstSendAttemptAt')::timestamptz <= ${cutoff}::timestamptz then ${now.toISOString()}::timestamptz else null end`,
      lastError: sql`case when (${scheduledActions.payload} ->> 'firstSendAttemptAt')::timestamptz <= ${cutoff}::timestamptz then 'Entrega do lembrete incerta; verificar destino antes de reenviar' else ${scheduledActions.lastError} end`,
    })
    .where(
      and(
        eq(scheduledActions.id, id),
        eq(scheduledActions.kind, 'reminder'),
        eq(scheduledActions.claimToken, claimToken),
        isNull(scheduledActions.doneAt),
        isNull(scheduledActions.failedAt),
      ),
    )
    .returning({ failedAt: scheduledActions.failedAt });
  return !row ? 'superseded' : row.failedAt ? 'uncertain' : 'ready';
}

/** Persistido antes do REST: uma queda jamais reivindica reversão possivelmente executada. */
export async function markScheduledUndoAttempting(
  db: DbExecutor,
  id: number,
  claimToken: string,
): Promise<boolean> {
  const [row] = await db
    .update(scheduledActions)
    .set({
      payload: sql`jsonb_set(${scheduledActions.payload}, '{undoAttemptAt}', to_jsonb(now()::text))`,
    })
    .where(
      and(
        eq(scheduledActions.id, id),
        inArray(scheduledActions.kind, ['unban', 'untimeout']),
        eq(scheduledActions.claimToken, claimToken),
        isNull(scheduledActions.doneAt),
        isNull(scheduledActions.failedAt),
        sql`not (${scheduledActions.payload} ? 'undoAttemptAt')`,
      ),
    )
    .returning({ id: scheduledActions.id });
  return Boolean(row);
}

/** Alerta operacional para reversão cujo REST pode ter concluído antes de crash. */
export async function markStaleScheduledUndos(
  db: DbExecutor,
  now = new Date(),
): Promise<Array<{ id: number; guildId: string; payload: Record<string, unknown> }>> {
  return db
    .update(scheduledActions)
    .set({ failedAt: now, lastError: 'Reversão Discord incerta; verificar antes de repetir' })
    .where(
      and(
        inArray(scheduledActions.kind, ['unban', 'untimeout']),
        isNull(scheduledActions.doneAt),
        isNull(scheduledActions.failedAt),
        or(isNull(scheduledActions.leaseUntil), lte(scheduledActions.leaseUntil, now))!,
        sql`${scheduledActions.payload} ? 'undoAttemptAt'`,
      ),
    )
    .returning({
      id: scheduledActions.id,
      guildId: scheduledActions.guildId,
      payload: scheduledActions.payload,
    });
}

/**
 * Reserva ações vencidas por dez minutos. Uma queda libera o lease; conclusão
 * exige o token devolvido na reserva. `skip locked` separa workers concorrentes.
 */
export async function claimDueActions(
  db: Db,
  options: {
    limit?: number;
    now?: Date;
    kinds?: readonly ScheduledAction['kind'][];
    guildId?: string;
  } = {},
): Promise<ScheduledAction[]> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const conditions = [
      isNull(scheduledActions.doneAt),
      isNull(scheduledActions.failedAt),
      lte(scheduledActions.runAt, now),
      or(isNull(scheduledActions.leaseUntil), lte(scheduledActions.leaseUntil, now))!,
      sql`(${scheduledActions.payload} ->> 'transitionMarkerId' is null or exists (
        select 1 from scheduled_actions marker
        where marker.id::text = ${scheduledActions.payload} ->> 'transitionMarkerId'
          and marker.payload ->> 'transitionState' = 'applied'
      ))`,
      sql`not (${scheduledActions.kind} in ('unban', 'untimeout') and ${scheduledActions.payload} ? 'undoAttemptAt')`,
    ];
    if (options.kinds?.length) {
      conditions.push(inArray(scheduledActions.kind, [...options.kinds]));
    }
    if (options.guildId) conditions.push(eq(scheduledActions.guildId, options.guildId));
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
      .set({
        // Nonce de lembrete só é deduplicado pelo Discord por poucos minutos.
        // Reivindicar de novo em 90s cobre a recuperação normal após crash.
        leaseUntil: sql<Date>`case when ${scheduledActions.kind} = 'reminder'
          then ${new Date(now.getTime() + 90_000).toISOString()}::timestamptz
          else ${new Date(now.getTime() + 10 * 60_000).toISOString()}::timestamptz end`,
        claimToken: sql`gen_random_uuid()`,
        attempts: sql`${scheduledActions.attempts} + 1`,
      })
      .where(
        inArray(
          scheduledActions.id,
          due.map((row) => row.id),
        ),
      )
      .returning();
  });
}

/** Ação ainda reservada por este worker, mesmo após uma alteração concorrente? */
export async function isScheduledActionActive(
  db: DbExecutor,
  id: number,
  claimToken: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: scheduledActions.id })
    .from(scheduledActions)
    .where(
      and(
        eq(scheduledActions.id, id),
        eq(scheduledActions.claimToken, claimToken),
        isNull(scheduledActions.doneAt),
        isNull(scheduledActions.failedAt),
      ),
    )
    .limit(1)
    .for('update');
  return Boolean(row);
}

/** Conclui apenas a reserva que efetivamente executou o efeito. */
export async function completeScheduledAction(
  db: DbExecutor,
  id: number,
  claimToken: string,
): Promise<boolean> {
  const [row] = await db
    .update(scheduledActions)
    .set({ doneAt: sql`now()`, leaseUntil: null, claimToken: null, lastError: null })
    .where(
      and(
        eq(scheduledActions.id, id),
        eq(scheduledActions.claimToken, claimToken),
        isNull(scheduledActions.doneAt),
      ),
    )
    .returning({ id: scheduledActions.id });
  return Boolean(row);
}

/** Agenda repetição ou preserva a falha terminal após oito tentativas. */
export async function failScheduledAction(
  db: DbExecutor,
  input: { id: number; claimToken: string; attempts: number; error: string; now?: Date },
): Promise<'retry' | 'terminal' | 'superseded'> {
  const now = input.now ?? new Date();
  const terminal = input.attempts >= 8;
  const delayMs = Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, input.attempts - 1));
  const [row] = await db
    .update(scheduledActions)
    .set({
      claimToken: null,
      leaseUntil: terminal ? null : new Date(now.getTime() + delayMs),
      failedAt: terminal ? now : null,
      lastError: input.error.slice(0, 500),
    })
    .where(
      and(
        eq(scheduledActions.id, input.id),
        eq(scheduledActions.claimToken, input.claimToken),
        isNull(scheduledActions.doneAt),
        isNull(scheduledActions.failedAt),
      ),
    )
    .returning({ id: scheduledActions.id });
  return row ? (terminal ? 'terminal' : 'retry') : 'superseded';
}

/** Serializa efeitos Discord e transições de punição do mesmo alvo. */
const effectPermits = new WeakMap<Db, { active: number; waiting: Array<() => void> }>();

/** Reserva no máximo duas conexões do pool para efeitos externos longos. */
export async function withDbEffectPermit<T>(db: Db, action: () => Promise<T>): Promise<T> {
  let state = effectPermits.get(db);
  if (!state) {
    state = { active: 0, waiting: [] };
    effectPermits.set(db, state);
  }
  if (state.active >= 2) {
    await new Promise<void>((resolve) => state!.waiting.push(resolve));
  } else {
    state.active++;
  }
  try {
    return await action();
  } finally {
    const next = state.waiting.shift();
    if (next) next();
    else state.active--;
  }
}

export async function withPunishmentLock<T>(
  db: Db,
  guildId: string,
  kind: 'unban' | 'untimeout',
  targetId: string,
  action: (tx: DbExecutor) => Promise<T>,
): Promise<T> {
  return withDbEffectPermit(db, () =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('goodbot:punishment'), hashtext(${`${guildId}:${kind}:${targetId}`}))`,
      );
      return action(tx);
    }),
  );
}

/**
 * Cancela ações pendentes de um alvo — um `/unban` manual antes do tempban
 * expirar não pode deixar um `unban` agendado para ninguém.
 */
export async function cancelScheduledActions(
  db: DbExecutor,
  input: { guildId: string; kind: ScheduledAction['kind']; targetId: string },
): Promise<number> {
  return (await cancelScheduledActionsInternal(db, input)).directCount;
}

/** IDs em ordem recente→antigo, incluindo o ancestral de reservas não aplicadas. */
export async function cancelScheduledActionsWithIds(
  db: DbExecutor,
  input: { guildId: string; kind: ScheduledAction['kind']; targetId: string },
): Promise<number[]> {
  return (await cancelScheduledActionsInternal(db, input)).ids;
}

async function cancelScheduledActionsInternal(
  db: DbExecutor,
  input: { guildId: string; kind: ScheduledAction['kind']; targetId: string },
): Promise<{ ids: number[]; directCount: number }> {
  const [priorMarker] = await db
    .select({ payload: scheduledActions.payload })
    .from(scheduledActions)
    .where(
      and(
        eq(scheduledActions.guildId, input.guildId),
        eq(scheduledActions.kind, input.kind),
        sql`${scheduledActions.payload} ->> 'targetId' = ${input.targetId}`,
        sql`${scheduledActions.payload} ->> 'transitionMarker' = 'true'`,
      ),
    )
    .orderBy(desc(scheduledActions.id))
    .limit(1);
  const rows = await db
    .update(scheduledActions)
    .set({
      doneAt: sql`now()`,
      leaseUntil: null,
      claimToken: null,
    })
    .where(
      and(
        eq(scheduledActions.guildId, input.guildId),
        eq(scheduledActions.kind, input.kind),
        isNull(scheduledActions.doneAt),
        sql`${scheduledActions.payload} ->> 'targetId' = ${input.targetId}`,
      ),
    )
    .returning({ id: scheduledActions.id, payload: scheduledActions.payload });
  const markerIds = rows
    .map((row) => row.payload.transitionMarkerId)
    .filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id));
  const markers = markerIds.length
    ? await db
        .select({ id: scheduledActions.id, payload: scheduledActions.payload })
        .from(scheduledActions)
        .where(inArray(scheduledActions.id, markerIds))
    : [];
  const markerStates = new Map(
    markers.map((marker) => [marker.id, marker.payload.transitionState]),
  );
  const ids = new Set<number>();
  for (const row of rows.sort((a, b) => b.id - a.id)) {
    ids.add(row.id);
    if (markerStates.get(row.payload.transitionMarkerId as number) !== 'prepared') continue;
    const fallback = row.payload.fallbackActionIds;
    if (Array.isArray(fallback)) {
      for (const id of fallback) if (Number.isSafeInteger(id)) ids.add(id as number);
    }
  }
  const priorFallback = priorMarker?.payload.fallbackActionIds;
  if (priorMarker?.payload.transitionState === 'prepared' && Array.isArray(priorFallback)) {
    for (const id of priorFallback) if (Number.isSafeInteger(id)) ids.add(id as number);
  }
  return { ids: [...ids], directCount: rows.length };
}

/** Desfaz atomicamente a reserva quando o Discord confirmou que não aplicou a ação. */
export async function compensateScheduledPunishment(
  db: DbExecutor,
  oldActionIds: number[],
  newActionId?: number,
): Promise<void> {
  if (oldActionIds.length > 0) {
    await db.execute(sql`update scheduled_actions as old
      set done_at = null, lease_until = null, claim_token = null
      where old.id = (
        select prior.id from unnest(array[${sql.join(
          oldActionIds.map((id) => sql`${id}`),
          sql`, `,
        )}]::bigint[])
          with ordinality as wanted(id, position)
        join scheduled_actions prior on prior.id = wanted.id
        where prior.payload ->> 'transitionMarkerId' is null or exists (
          select 1 from scheduled_actions marker
          where marker.id::text = prior.payload ->> 'transitionMarkerId'
            and marker.payload ->> 'transitionState' = 'applied'
        )
        order by wanted.position
        limit 1
      )`);
  }
  if (newActionId !== undefined) {
    await db
      .update(scheduledActions)
      .set({ doneAt: sql`now()`, leaseUntil: null, claimToken: null })
      .where(eq(scheduledActions.id, newActionId));
  }
}

/**
 * Últimos casos da guild — o bloco "atividade recente" do dashboard
 * (PRD §6.1). Casos apagados (soft delete) não entram.
 */
export async function listRecentCases(
  db: DbExecutor,
  guildId: string,
  limit = 10,
): Promise<Case[]> {
  return db
    .select()
    .from(cases)
    .where(and(eq(cases.guildId, guildId), isNull(cases.deletedAt)))
    .orderBy(desc(cases.createdAt))
    .limit(limit);
}

// ── busca do painel ─────────────────────────────────────────────────────────

/** Filtros da página de casos (PRD §6.4). Tudo opcional exceto a guild. */
export interface CaseSearchFilters {
  guildId: string;
  type?: readonly Case['type'][];
  source?: readonly Case['source'][];
  actorId?: string;
  targetId?: string;
  from?: Date;
  /** Instante final **exclusivo**. */
  to?: Date;
  /** Texto livre: motivo, tag do alvo/moderador ou número do caso. */
  q?: string;
  includeDeleted?: boolean;
}

export interface CaseSearchOptions extends CaseSearchFilters {
  /** 1-based; a URL da página é 1-based e não vale traduzir duas vezes. */
  page?: number;
  pageSize?: number;
  sort?: 'createdAt' | 'caseNumber';
  direction?: 'asc' | 'desc';
}

export interface SearchResult<T> {
  rows: T[];
  total: number;
}

/** Teto de página; o export de CSV pede o máximo de uma vez (PRD §6.4). */
export const MAX_CASE_PAGE_SIZE = 10_000;

function caseConditions(filters: CaseSearchFilters): SQL[] {
  const conditions: SQL[] = [eq(cases.guildId, filters.guildId)];
  if (!filters.includeDeleted) conditions.push(isNull(cases.deletedAt));
  if (filters.type?.length) conditions.push(inArray(cases.type, [...filters.type]));
  if (filters.source?.length) conditions.push(inArray(cases.source, [...filters.source]));
  if (filters.actorId) conditions.push(eq(cases.actorId, filters.actorId));
  if (filters.targetId) conditions.push(eq(cases.targetId, filters.targetId));
  if (filters.from) conditions.push(gte(cases.createdAt, filters.from));
  if (filters.to) conditions.push(lt(cases.createdAt, filters.to));

  const term = filters.q?.trim();
  if (term) {
    const like = `%${term.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
    const parts: SQL[] = [
      ilike(cases.reason, like),
      ilike(cases.targetTag, like),
      ilike(cases.actorTag, like),
    ];
    // "#12" e "12" acham o caso pelo número; digitar isso na busca é reflexo.
    const asNumber = Number(term.replace(/^#/, ''));
    if (Number.isInteger(asNumber) && asNumber > 0) {
      parts.push(eq(cases.caseNumber, asNumber));
    }
    const combined = or(...parts);
    if (combined) conditions.push(combined);
  }
  return conditions;
}

/**
 * Busca paginada de casos com o total (PRD §6.4). O total vem de uma segunda
 * query em vez de `count(*) over ()`: com filtro que não casa com nada, a
 * janela não devolveria linha nenhuma e o total viraria `undefined`.
 */
export async function searchCases(
  db: DbExecutor,
  options: CaseSearchOptions,
): Promise<SearchResult<Case>> {
  const page = Math.max(1, Math.trunc(options.page ?? 1));
  const pageSize = Math.min(MAX_CASE_PAGE_SIZE, Math.max(1, Math.trunc(options.pageSize ?? 25)));
  const conditions = caseConditions(options);
  const where = and(...conditions);

  const column = options.sort === 'caseNumber' ? cases.caseNumber : cases.createdAt;
  const order = options.direction === 'asc' ? asc(column) : desc(column);

  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(cases)
      .where(where)
      .orderBy(order, desc(cases.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: sql<number>`count(*)` })
      .from(cases)
      .where(where),
  ]);

  return { rows, total: Number(totalRow?.total ?? 0) };
}
