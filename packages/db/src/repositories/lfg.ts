import { UserFacingError } from '@goodbot/shared';
import { and, asc, count, eq, inArray, lte, sql } from 'drizzle-orm';

import { lfgSessionMembers, lfgSessions } from '../schema/community';

import type { Db, DbExecutor } from '../client';
import type { LfgSession, LfgSessionMember } from '../types';
import type {
  LfgMemberStatus,
  LfgSessionStatus,
  LfgVisibility,
  Roster,
  RosterChange,
  RosterEntry,
} from '@goodbot/shared';

/**
 * A agenda de jogatinas do módulo squads (PRD §5.11). Toda mudança na lista
 * passa por `mutateLfgRoster`, que trava a jogatina: dois cliques em VOU com
 * uma vaga só nunca sentam os dois.
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
  startsAt: Date;
  slots: number;
  visibility: LfgVisibility;
  note: string | null;
}

/** A jogatina nasce com o host na lista, ocupando a primeira vaga. */
export async function createLfgSession(
  db: Db,
  input: CreateLfgSessionInput,
): Promise<LfgSessionWithRoster> {
  return db.transaction(async (tx) => {
    const [session] = await tx.insert(lfgSessions).values(input).returning();
    if (!session) throw new Error('INSERT em lfg_sessions não retornou linha');
    const [host] = await tx
      .insert(lfgSessionMembers)
      .values({
        sessionId: session.id,
        userId: input.hostId,
        status: 'host',
        joinedAt: session.createdAt,
      })
      .returning();
    if (!host) throw new Error('INSERT em lfg_session_members não retornou linha');
    return { session, roster: toRoster(session, [host]) };
  });
}

/** Jogatinas abertas (marcadas ou rolando) da guild, e quantas delas são do host. */
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

/** As próximas da guild (marcadas ou rolando), da mais próxima para a mais distante. */
export async function listUpcomingLfgSessions(
  db: DbExecutor,
  guildId: string,
  limit: number,
): Promise<LfgSession[]> {
  return db
    .select()
    .from(lfgSessions)
    .where(and(eq(lfgSessions.guildId, guildId), inArray(lfgSessions.status, OPEN_STATUSES)))
    .orderBy(asc(lfgSessions.startsAt))
    .limit(limit);
}

export interface MemberLfgSession {
  session: LfgSession;
  status: LfgMemberStatus;
}

/** As jogatinas abertas da guild em que a pessoa está (marcou, vai, espera ou pediu). */
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
 * O que o relógio precisa olhar, de todas as guilds: abertas que começam até
 * `until`. O relógio passa `now + LFG_CALL_MINUTES`, a antecedência mais longa.
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
    | 'calledAt'
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

function sameEntry(a: RosterEntry, b: RosterEntry): boolean {
  return a.status === b.status && a.joinedAt === b.joinedAt;
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
        })
        .onConflictDoUpdate({
          target: [lfgSessionMembers.sessionId, lfgSessionMembers.userId],
          set: { status: entry.status, joinedAt: new Date(entry.joinedAt) },
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
