import { UserFacingError } from '@goodbot/shared';
import { and, asc, count, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import { isUniqueViolation } from './pg-errors';
import { lfgSessionMembers, lfgSessions } from '../schema/community';

import type { Db, DbExecutor } from '../client';
import type { LfgSession, LfgSessionMember } from '../types';
import type {
  LfgKind,
  LfgMemberStatus,
  LfgSessionStatus,
  LfgVisibility,
  Roster,
  RosterChange,
  RosterEntry,
} from '@goodbot/shared';

/**
 * Cards e jogatinas do módulo squads (PRD §5.11), a mesma tabela com `kind`.
 * Toda mudança na lista passa por `mutateLfgRoster`, que trava a linha: dois
 * cliques em VOU com uma vaga só nunca sentam os dois.
 */

/** Status em que a jogatina ainda aceita gente e o relógio ainda age. */
const OPEN_STATUSES = ['scheduled', 'live'] as const;

export interface LfgSessionWithRoster {
  session: LfgSession;
  roster: Roster;
}

export function toRoster(session: LfgSession, members: LfgSessionMember[]): Roster {
  return {
    hostId: session.hostId,
    slots: session.slots,
    visibility: session.visibility,
    entries: members.map((member) => ({
      userId: member.userId,
      status: member.status,
      joinedAt: member.joinedAt.getTime(),
      invitedBy: member.invitedBy,
    })),
  };
}

async function membersOf(db: DbExecutor, sessionId: string): Promise<LfgSessionMember[]> {
  return db
    .select()
    .from(lfgSessionMembers)
    .where(eq(lfgSessionMembers.sessionId, sessionId))
    .orderBy(asc(lfgSessionMembers.joinedAt));
}

export interface CreateLfgSessionInput {
  guildId: string;
  hostId: string;
  kind: LfgKind;
  startsAt: Date;
  slots: number;
  visibility: LfgVisibility;
  note: string | null;
  /** O card nasce com a sala já criada; a jogatina ganha a dela no início. */
  roomId?: string | null;
}

/** O índice parcial que segura um card aberto por pessoa. */
const OPEN_CALL_INDEX = 'lfg_sessions_open_call_uidx';

/**
 * Nasce com o host na lista, ocupando a primeira vaga. O card (`kind = now`)
 * nasce começado: `live`, com `startedAt` igual a `startsAt`. Um segundo card
 * aberto do mesmo host recusa com `LFG_CALL_OPEN`, mesmo que os dois modais
 * cheguem juntos.
 */
export async function createLfgSession(
  db: Db,
  input: CreateLfgSessionInput,
): Promise<LfgSessionWithRoster> {
  const values =
    input.kind === 'now' ? { ...input, status: 'live' as const, startedAt: input.startsAt } : input;
  try {
    return await insertLfgSession(db, input.hostId, values);
  } catch (error) {
    if (isUniqueViolation(error, OPEN_CALL_INDEX)) {
      throw new UserFacingError('Você já tem um card aberto. Feche ele antes de abrir outro.', {
        code: 'LFG_CALL_OPEN',
      });
    }
    throw error;
  }
}

async function insertLfgSession(
  db: Db,
  hostId: string,
  values: typeof lfgSessions.$inferInsert,
): Promise<LfgSessionWithRoster> {
  return db.transaction(async (tx) => {
    const [session] = await tx.insert(lfgSessions).values(values).returning();
    if (!session) throw new Error('INSERT em lfg_sessions não retornou linha');
    const [host] = await tx
      .insert(lfgSessionMembers)
      .values({
        sessionId: session.id,
        userId: hostId,
        status: 'host',
        joinedAt: session.createdAt,
      })
      .returning();
    if (!host) throw new Error('INSERT em lfg_session_members não retornou linha');
    return { session, roster: toRoster(session, [host]) };
  });
}

/**
 * Jogatinas e cards abertos (marcados ou rolando) da guild, e quantos deles são
 * do host. O teto do PRD conta os dois tipos juntos.
 */
export async function countOpenLfgSessions(
  db: DbExecutor,
  guildId: string,
  hostId: string,
): Promise<{ guild: number; host: number }> {
  const [row] = await db
    .select({
      guild: count(),
      host: sql<number>`count(*) filter (where ${lfgSessions.hostId} = ${hostId})`,
    })
    .from(lfgSessions)
    .where(and(eq(lfgSessions.guildId, guildId), inArray(lfgSessions.status, OPEN_STATUSES)));
  return { guild: Number(row?.guild ?? 0), host: Number(row?.host ?? 0) };
}

/** A jogatina com a lista. O `guildId` vem junto para um id nunca cruzar servidor. */
export async function getLfgSession(
  db: DbExecutor,
  guildId: string,
  sessionId: string,
): Promise<LfgSessionWithRoster | null> {
  const [session] = await db
    .select()
    .from(lfgSessions)
    .where(and(eq(lfgSessions.id, sessionId), eq(lfgSessions.guildId, guildId)))
    .limit(1);
  if (!session) return null;
  return { session, roster: toRoster(session, await membersOf(db, sessionId)) };
}

/**
 * As próximas da guild (marcadas ou rolando), da mais próxima para a mais
 * distante. Com `kind`, só daquele tipo.
 */
export async function listUpcomingLfgSessions(
  db: DbExecutor,
  guildId: string,
  limit: number,
  kind?: LfgKind,
): Promise<LfgSession[]> {
  return db
    .select()
    .from(lfgSessions)
    .where(
      and(
        eq(lfgSessions.guildId, guildId),
        inArray(lfgSessions.status, OPEN_STATUSES),
        kind ? eq(lfgSessions.kind, kind) : undefined,
      ),
    )
    .orderBy(asc(lfgSessions.startsAt))
    .limit(limit);
}

export interface MemberLfgSession {
  session: LfgSession;
  status: LfgMemberStatus;
}

/**
 * As jogatinas e os cards abertos da guild em que a pessoa está (marcou, vai,
 * pediu ou foi convidada): o MINHAS JOGATINAS.
 */
export async function listMemberLfgSessions(
  db: DbExecutor,
  guildId: string,
  userId: string,
  limit: number,
): Promise<MemberLfgSession[]> {
  return db
    .select({ session: lfgSessions, status: lfgSessionMembers.status })
    .from(lfgSessionMembers)
    .innerJoin(lfgSessions, eq(lfgSessions.id, lfgSessionMembers.sessionId))
    .where(
      and(
        eq(lfgSessionMembers.userId, userId),
        eq(lfgSessions.guildId, guildId),
        inArray(lfgSessions.status, OPEN_STATUSES),
      ),
    )
    .orderBy(asc(lfgSessions.startsAt))
    .limit(limit);
}

/**
 * O card aberto da pessoa, se houver: uma pessoa tem no máximo um, e tentar
 * outro recusa com o link deste.
 */
export async function getOpenLfgCallByHost(
  db: DbExecutor,
  guildId: string,
  hostId: string,
): Promise<LfgSession | null> {
  const [row] = await db
    .select()
    .from(lfgSessions)
    .where(
      and(
        eq(lfgSessions.guildId, guildId),
        eq(lfgSessions.hostId, hostId),
        eq(lfgSessions.kind, 'now'),
        inArray(lfgSessions.status, OPEN_STATUSES),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * O que o relógio precisa olhar, de todas as guilds: abertas que começam até
 * `until`. O relógio passa `now + LFG_REMINDER_MINUTES`, a antecedência mais
 * longa. O card nasce `live` com `startsAt` no passado, então sempre entra.
 */
export async function listDueLfgSessions(db: DbExecutor, until: Date): Promise<LfgSession[]> {
  return db
    .select()
    .from(lfgSessions)
    .where(and(inArray(lfgSessions.status, OPEN_STATUSES), lte(lfgSessions.startsAt, until)))
    .orderBy(asc(lfgSessions.startsAt));
}

export type LfgSessionPatch = Partial<
  Pick<
    LfgSession,
    | 'startsAt'
    | 'note'
    | 'status'
    | 'channelId'
    | 'messageId'
    | 'threadId'
    | 'roomId'
    | 'remindedAt'
    | 'startedAt'
    | 'endedAt'
  >
>;

/**
 * Grava campos da jogatina. Só mexe em jogatina aberta: `null` quando ela já
 * acabou ou foi cancelada, e quem chama sabe que perdeu a corrida. Remarcar e
 * cancelar passam `['scheduled']`, porque a que já começou é do relógio.
 */
export async function updateLfgSession(
  db: DbExecutor,
  guildId: string,
  sessionId: string,
  patch: LfgSessionPatch,
  statuses: readonly LfgSessionStatus[] = OPEN_STATUSES,
): Promise<LfgSession | null> {
  const [row] = await db
    .update(lfgSessions)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(
      and(
        eq(lfgSessions.id, sessionId),
        eq(lfgSessions.guildId, guildId),
        inArray(lfgSessions.status, [...statuses]),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * DIVULGAR: grava `promotedAt = now` se a jogatina ainda está marcada e o
 * último DIVULGAR foi há pelo menos `cooldownMs`. `null` é "não pode agora"
 * (cedo demais, ou a jogatina começou ou acabou): o teste e a escrita são um
 * UPDATE só, então dois cliques juntos nunca divulgam duas vezes.
 */
export async function setLfgPromotedAt(
  db: DbExecutor,
  guildId: string,
  sessionId: string,
  now: Date,
  cooldownMs: number,
): Promise<LfgSession | null> {
  const [row] = await db
    .update(lfgSessions)
    .set({ promotedAt: now, updatedAt: sql`now()` })
    .where(
      and(
        eq(lfgSessions.id, sessionId),
        eq(lfgSessions.guildId, guildId),
        eq(lfgSessions.status, 'scheduled'),
        or(
          isNull(lfgSessions.promotedAt),
          lte(lfgSessions.promotedAt, new Date(now.getTime() - cooldownMs)),
        ),
      ),
    )
    .returning();
  return row ?? null;
}

function sameEntry(a: RosterEntry, b: RosterEntry): boolean {
  return (
    a.status === b.status &&
    a.joinedAt === b.joinedAt &&
    (a.invitedBy ?? null) === (b.invitedBy ?? null)
  );
}

/**
 * Aplica uma regra de `@goodbot/shared` (joinRoster, leaveRoster...) com a
 * jogatina travada e grava só a diferença. Erro da regra (`UserFacingError`)
 * desfaz a transação e sobe como está.
 */
export async function mutateLfgRoster<O>(
  db: Db,
  guildId: string,
  sessionId: string,
  mutate: (roster: Roster, session: LfgSession) => RosterChange<O>,
): Promise<{ session: LfgSession; change: RosterChange<O> }> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(lfgSessions)
      .where(and(eq(lfgSessions.id, sessionId), eq(lfgSessions.guildId, guildId)))
      .for('update');
    if (!locked || !(OPEN_STATUSES as readonly string[]).includes(locked.status)) {
      throw new UserFacingError('Essa jogatina já acabou ou foi cancelada.', {
        code: 'LFG_SESSION_CLOSED',
      });
    }
    const before = toRoster(locked, await membersOf(tx, sessionId));
    const change = mutate(before, locked);
    const after = change.roster;

    const previous = new Map(before.entries.map((entry) => [entry.userId, entry]));
    const next = new Map(after.entries.map((entry) => [entry.userId, entry]));
    const removed = [...previous.keys()].filter((userId) => !next.has(userId));
    if (removed.length > 0) {
      await tx
        .delete(lfgSessionMembers)
        .where(
          and(
            eq(lfgSessionMembers.sessionId, sessionId),
            inArray(lfgSessionMembers.userId, removed),
          ),
        );
    }
    for (const entry of after.entries) {
      const old = previous.get(entry.userId);
      if (old && sameEntry(old, entry)) continue;
      await tx
        .insert(lfgSessionMembers)
        .values({
          sessionId,
          userId: entry.userId,
          status: entry.status,
          joinedAt: new Date(entry.joinedAt),
          invitedBy: entry.invitedBy ?? null,
        })
        .onConflictDoUpdate({
          target: [lfgSessionMembers.sessionId, lfgSessionMembers.userId],
          set: {
            status: entry.status,
            joinedAt: new Date(entry.joinedAt),
            invitedBy: entry.invitedBy ?? null,
          },
        });
    }

    let session = locked;
    if (after.slots !== before.slots || after.visibility !== before.visibility) {
      const [updated] = await tx
        .update(lfgSessions)
        .set({ slots: after.slots, visibility: after.visibility, updatedAt: sql`now()` })
        .where(eq(lfgSessions.id, sessionId))
        .returning();
      if (updated) session = updated;
    }
    return { session, change };
  });
}
