import { randomUUID } from 'node:crypto';

import {
  HOUR_MS,
  isSessionOver,
  joinRequestKey,
  MINUTE_MS,
  pairKey,
  SQUAD_OPEN_REQUEST_STATUSES,
} from '@goodbot/shared';
import { TransactionRollbackError } from 'drizzle-orm';
import { vi } from 'vitest';

import type {
  Db,
  LockOverwrite,
  Squad,
  SquadGame,
  SquadJoinRequest,
  SquadMember,
  SquadProfile,
  SquadProposal,
  SquadSession,
  SquadSessionAttendance,
  SquadSessionGuest,
} from '@goodbot/db';
import type {
  SquadAnswers,
  SquadOpenRequestStatus,
  SquadProfileStatus,
  SquadRequestStatus,
  SquadStatus,
} from '@goodbot/shared';
import type { Mock } from 'vitest';

/**
 * `@goodbot/db` em memória para os testes do módulo `squads`: as mesmas
 * funções de `repositories/squads.ts`, com as mesmas travas (`null` quando a
 * `UPDATE` condicional não pegaria linha). Carregado por `vi.hoisted` e
 * entregue ao `vi.mock('@goodbot/db')` de cada teste.
 */

export const GUILD_ID = '900000000000000000';

export interface FakeStore {
  games: SquadGame[];
  profiles: SquadProfile[];
  squads: Squad[];
  members: SquadMember[];
  proposals: SquadProposal[];
  requests: SquadJoinRequest[];
  sessions: SquadSession[];
  attendance: SquadSessionAttendance[];
  guests: SquadSessionGuest[];
  meta: Map<string, unknown>;
}

const emptyStore = (): FakeStore => ({
  games: [],
  profiles: [],
  squads: [],
  members: [],
  proposals: [],
  requests: [],
  sessions: [],
  attendance: [],
  guests: [],
  meta: new Map(),
});

export const store: FakeStore = emptyStore();

/** Ganchos para simular o que outra conexão faz no meio de um fluxo. */
export const hooks: { beforeTransaction?: () => void } = {};

let clock: () => number = Date.now;
let sessionSeq = 0;
let tick = 0;

/** Instantes sempre crescentes, como `now()` de transações seguidas. */
const stamp = () => new Date(clock() + tick++);

export function resetStore(now: () => number): void {
  Object.assign(store, emptyStore());
  clock = now;
  sessionSeq = 0;
  tick = 0;
  delete hooks.beforeTransaction;
}

const copy = <T>(value: T): T => structuredClone(value);
const maybe = <T>(value: T | undefined): T | null => (value === undefined ? null : copy(value));

const findSquad = (guildId: string, squadId: string) =>
  store.squads.find((squad) => squad.guildId === guildId && squad.id === squadId);
const findProposal = (guildId: string, proposalId: string) =>
  store.proposals.find((proposal) => proposal.guildId === guildId && proposal.id === proposalId);
const findRequest = (guildId: string, requestId: string) =>
  store.requests.find((request) => request.guildId === guildId && request.id === requestId);
const findSession = (guildId: string, sessionId: number) =>
  store.sessions.find((session) => session.guildId === guildId && session.id === sessionId);
const findProfile = (guildId: string, userId: string, gameId: string) =>
  store.profiles.find(
    (profile) =>
      profile.guildId === guildId && profile.userId === userId && profile.gameId === gameId,
  );

const isOpen = (status: SquadRequestStatus) =>
  (SQUAD_OPEN_REQUEST_STATUSES as readonly string[]).includes(status);

const byUserId = (a: { userId: string }, b: { userId: string }) =>
  a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;

export const impl = {
  // ── config (só a escrita da mensagem fixa; a leitura é o ConfigService falso)
  async setModuleConfig(_db: unknown, _guildId: string, _module: string, input: unknown) {
    return copy(input);
  },

  // ── meta
  squadsDailyKey(guildId: string) {
    return `squads_daily:${guildId}`;
  },
  async getMeta(_db: unknown, key: string) {
    return store.meta.has(key) ? copy(store.meta.get(key)) : null;
  },
  async setMeta(_db: unknown, key: string, value: unknown) {
    store.meta.set(key, copy(value));
  },

  // ── jogos
  async listSquadGames(_db: unknown, guildId: string) {
    return copy(
      store.games
        .filter((game) => game.guildId === guildId)
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    );
  },
  async getSquadGame(_db: unknown, guildId: string, gameId: string) {
    return maybe(store.games.find((game) => game.guildId === guildId && game.id === gameId));
  },

  // ── perfis
  async upsertSquadProfile(
    _db: unknown,
    input: {
      guildId: string;
      userId: string;
      gameId: string;
      availability: number;
      answers: SquadAnswers;
      status?: SquadProfileStatus;
    },
  ) {
    let row = findProfile(input.guildId, input.userId, input.gameId);
    if (row) {
      row.availability = input.availability;
      row.answers = input.answers;
      if (input.status) row.status = input.status;
      row.updatedAt = stamp();
    } else {
      row = {
        guildId: input.guildId,
        userId: input.userId,
        gameId: input.gameId,
        availability: input.availability,
        answers: input.answers,
        status: input.status ?? 'searching',
        lastMatchedAt: null,
        createdAt: stamp(),
        updatedAt: stamp(),
      };
      store.profiles.push(row);
    }
    return copy(row);
  },
  async createSquadProfileIfMissing(
    _db: unknown,
    input: {
      guildId: string;
      userId: string;
      gameId: string;
      availability: number;
      answers: SquadAnswers;
      status?: SquadProfileStatus;
    },
  ) {
    if (findProfile(input.guildId, input.userId, input.gameId)) return null;
    const row: SquadProfile = {
      ...input,
      status: input.status ?? 'searching',
      lastMatchedAt: null,
      createdAt: stamp(),
      updatedAt: stamp(),
    };
    store.profiles.push(row);
    return copy(row);
  },
  async getSquadProfile(_db: unknown, guildId: string, userId: string, gameId: string) {
    return maybe(findProfile(guildId, userId, gameId));
  },
  async listSearchingProfiles(_db: unknown, guildId: string, gameId: string) {
    return copy(
      store.profiles
        .filter(
          (profile) =>
            profile.guildId === guildId &&
            profile.gameId === gameId &&
            profile.status === 'searching',
        )
        .sort(byUserId),
    );
  },
  async listSquadProfilesByGame(
    _db: unknown,
    guildId: string,
    gameId: string,
    options: { userIds?: readonly string[] } = {},
  ) {
    return copy(
      store.profiles
        .filter(
          (profile) =>
            profile.guildId === guildId &&
            profile.gameId === gameId &&
            (!options.userIds || options.userIds.includes(profile.userId)),
        )
        .sort(byUserId),
    );
  },
  async deleteSquadProfile(_db: unknown, guildId: string, userId: string, gameId: string) {
    const index = store.profiles.findIndex(
      (profile) =>
        profile.guildId === guildId && profile.userId === userId && profile.gameId === gameId,
    );
    if (index < 0) return null;
    const [row] = store.profiles.splice(index, 1);
    return maybe(row);
  },
  async countSearchingProfilesByGame(_db: unknown, guildId: string) {
    const counts: Record<string, number> = {};
    for (const profile of store.profiles) {
      if (profile.guildId !== guildId || profile.status !== 'searching') continue;
      counts[profile.gameId] = (counts[profile.gameId] ?? 0) + 1;
    }
    return counts;
  },
  async setSquadProfileStatus(
    _db: unknown,
    guildId: string,
    userId: string,
    gameId: string,
    status: SquadProfileStatus,
  ) {
    const row = findProfile(guildId, userId, gameId);
    if (!row) return null;
    row.status = status;
    row.updatedAt = stamp();
    return copy(row);
  },
  async markProfilesMatched(
    _db: unknown,
    guildId: string,
    gameId: string,
    userIds: readonly string[],
    at: Date,
  ) {
    let changed = 0;
    for (const userId of userIds) {
      const row = findProfile(guildId, userId, gameId);
      if (!row) continue;
      row.lastMatchedAt = at;
      changed++;
    }
    return changed;
  },

  // ── squads
  async createSquad(
    _db: unknown,
    input: {
      guildId: string;
      gameId: string;
      name: string;
      voiceChannelId?: string | null;
      status?: 'open' | 'full';
    },
  ) {
    const row: Squad = {
      id: randomUUID(),
      guildId: input.guildId,
      gameId: input.gameId,
      name: input.name,
      textChannelId: null,
      voiceChannelId: input.voiceChannelId ?? null,
      guideMessageId: null,
      status: input.status ?? 'open',
      lastConfirmedAt: null,
      warnedAt: null,
      archivedAt: null,
      createdAt: stamp(),
      updatedAt: stamp(),
    };
    store.squads.push(row);
    return copy(row);
  },
  async getSquad(_db: unknown, guildId: string, squadId: string) {
    return maybe(findSquad(guildId, squadId));
  },
  async listSquads(
    _db: unknown,
    guildId: string,
    options: { gameId?: string; statuses?: readonly SquadStatus[] } = {},
  ) {
    return copy(
      store.squads.filter(
        (squad) =>
          squad.guildId === guildId &&
          (!options.gameId || squad.gameId === options.gameId) &&
          (!options.statuses?.length || options.statuses.includes(squad.status)),
      ),
    );
  },
  async setSquadTextChannel(
    _db: unknown,
    guildId: string,
    squadId: string,
    textChannelId: string | null,
  ) {
    const row = findSquad(guildId, squadId);
    if (!row) return null;
    row.textChannelId = textChannelId;
    return copy(row);
  },
  async setSquadVoiceChannel(
    _db: unknown,
    guildId: string,
    squadId: string,
    voiceChannelId: string | null,
  ) {
    const row = findSquad(guildId, squadId);
    if (!row) return null;
    row.voiceChannelId = voiceChannelId;
    return copy(row);
  },
  async setSquadStatus(_db: unknown, guildId: string, squadId: string, status: 'open' | 'full') {
    const row = findSquad(guildId, squadId);
    if (!row || row.status === 'archived') return null;
    row.status = status;
    return copy(row);
  },
  async renameSquad(_db: unknown, guildId: string, squadId: string, name: string) {
    const row = findSquad(guildId, squadId);
    if (!row) return null;
    row.name = name;
    return copy(row);
  },
  async archiveSquad(_db: unknown, guildId: string, squadId: string, at: Date) {
    const row = findSquad(guildId, squadId);
    if (!row || row.status === 'archived') return null;
    row.status = 'archived';
    row.archivedAt = at;
    return copy(row);
  },
  async setSquadGuideMessage(
    _db: unknown,
    guildId: string,
    squadId: string,
    messageId: string | null,
    expected: string | null,
  ) {
    const row = findSquad(guildId, squadId);
    if (!row || row.guideMessageId !== expected) return null;
    row.guideMessageId = messageId;
    return copy(row);
  },
  async touchSquadConfirmed(_db: unknown, guildId: string, squadId: string, at: Date) {
    const row = findSquad(guildId, squadId);
    if (!row) return null;
    row.lastConfirmedAt = at;
    return copy(row);
  },
  async markSquadWarned(_db: unknown, guildId: string, squadId: string, at: Date) {
    const row = findSquad(guildId, squadId);
    if (!row || row.warnedAt || row.status === 'archived') return null;
    row.warnedAt = at;
    return copy(row);
  },
  async clearSquadWarned(_db: unknown, guildId: string, squadId: string) {
    const row = findSquad(guildId, squadId);
    if (!row) return null;
    row.warnedAt = null;
    return copy(row);
  },
  async listOpenSquadsByGame(_db: unknown, guildId: string, gameId: string) {
    return copy(
      store.squads.filter(
        (squad) => squad.guildId === guildId && squad.gameId === gameId && squad.status === 'open',
      ),
    );
  },
  async listInactiveSquads(_db: unknown, guildId: string, since: Date) {
    return copy(
      store.squads.filter(
        (squad) =>
          squad.guildId === guildId &&
          squad.status !== 'archived' &&
          (squad.lastConfirmedAt ?? squad.createdAt).getTime() < since.getTime(),
      ),
    );
  },

  // ── membros
  async addSquadMember(_db: unknown, input: { guildId: string; squadId: string; userId: string }) {
    if (store.members.some((m) => m.squadId === input.squadId && m.userId === input.userId)) {
      return null;
    }
    const row: SquadMember = { ...input, joinedAt: stamp() };
    store.members.push(row);
    return copy(row);
  },
  async removeSquadMember(_db: unknown, guildId: string, squadId: string, userId: string) {
    const index = store.members.findIndex(
      (m) => m.guildId === guildId && m.squadId === squadId && m.userId === userId,
    );
    if (index < 0) return null;
    const [row] = store.members.splice(index, 1);
    return maybe(row);
  },
  async listSquadMembers(_db: unknown, guildId: string, squadId: string) {
    return copy(
      store.members
        .filter((m) => m.guildId === guildId && m.squadId === squadId)
        .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime()),
    );
  },
  async listMembersOfSquads(_db: unknown, guildId: string, squadIds: readonly string[]) {
    return copy(
      store.members
        .filter((m) => m.guildId === guildId && squadIds.includes(m.squadId))
        .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime()),
    );
  },
  async countSquadsForUser(_db: unknown, guildId: string, userId: string) {
    return store.members.filter(
      (m) =>
        m.guildId === guildId &&
        m.userId === userId &&
        findSquad(guildId, m.squadId)?.status !== 'archived',
    ).length;
  },
  async listSquadsForUser(
    _db: unknown,
    guildId: string,
    userId: string,
    options: { includeArchived?: boolean } = {},
  ) {
    return copy(
      store.members
        .filter((m) => m.guildId === guildId && m.userId === userId)
        .flatMap((m) => {
          const squad = findSquad(guildId, m.squadId);
          return squad && (options.includeArchived || squad.status !== 'archived') ? [squad] : [];
        }),
    );
  },

  // ── propostas
  async createSquadProposal(
    _db: unknown,
    input: {
      guildId: string;
      gameId: string;
      userIds: string[];
      threadId: string;
      expiresAt: Date;
    },
  ) {
    const row: SquadProposal = {
      id: randomUUID(),
      ...input,
      messageId: null,
      acceptedIds: [],
      declinedIds: [],
      squadId: null,
      closedAt: null,
      createdAt: stamp(),
    };
    store.proposals.push(row);
    return copy(row);
  },
  async setSquadProposalMessage(
    _db: unknown,
    guildId: string,
    proposalId: string,
    messageId: string,
  ) {
    const row = findProposal(guildId, proposalId);
    if (!row) return null;
    row.messageId = messageId;
    return copy(row);
  },
  async getSquadProposal(_db: unknown, guildId: string, proposalId: string) {
    return maybe(findProposal(guildId, proposalId));
  },
  async claimProposalSquad(_db: unknown, guildId: string, proposalId: string, squadId: string) {
    const row = findProposal(guildId, proposalId);
    if (!row || row.squadId || row.closedAt) return null;
    row.squadId = squadId;
    return copy(row);
  },
  async acceptSquadProposal(_db: unknown, guildId: string, proposalId: string, userId: string) {
    const row = findProposal(guildId, proposalId);
    if (!row || row.closedAt || !row.userIds.includes(userId) || row.acceptedIds.includes(userId)) {
      return null;
    }
    row.acceptedIds = [...row.acceptedIds, userId];
    row.declinedIds = row.declinedIds.filter((id) => id !== userId);
    return copy(row);
  },
  async declineSquadProposal(_db: unknown, guildId: string, proposalId: string, userId: string) {
    const row = findProposal(guildId, proposalId);
    if (!row || row.closedAt || !row.userIds.includes(userId) || row.declinedIds.includes(userId)) {
      return null;
    }
    row.declinedIds = [...row.declinedIds, userId];
    row.acceptedIds = row.acceptedIds.filter((id) => id !== userId);
    return copy(row);
  },
  async closeSquadProposal(_db: unknown, guildId: string, proposalId: string, at: Date) {
    const row = findProposal(guildId, proposalId);
    if (!row || row.closedAt) return null;
    row.closedAt = at;
    return copy(row);
  },
  async listOpenSquadProposals(_db: unknown, guildId: string) {
    return copy(store.proposals.filter((p) => p.guildId === guildId && !p.closedAt));
  },
  async listExpiredSquadProposals(_db: unknown, guildId: string, now: Date) {
    return copy(
      store.proposals.filter(
        (p) => p.guildId === guildId && !p.closedAt && p.expiresAt.getTime() <= now.getTime(),
      ),
    );
  },
  async listRecentProposalPairs(_db: unknown, guildId: string, gameId: string, since: Date) {
    const keys = new Set<string>();
    for (const proposal of store.proposals) {
      if (proposal.guildId !== guildId || proposal.gameId !== gameId) continue;
      if (proposal.createdAt.getTime() < since.getTime()) continue;
      proposal.userIds.forEach((a, index) => {
        for (const b of proposal.userIds.slice(index + 1)) if (a !== b) keys.add(pairKey(a, b));
      });
    }
    return [...keys];
  },

  // ── pedidos de entrada
  async createSquadJoinRequest(
    _db: unknown,
    input: {
      guildId: string;
      squadId: string;
      userId: string;
      status: SquadOpenRequestStatus;
      invitedBy?: string | null;
      sessionId?: number | null;
      expiresAt: Date;
    },
  ) {
    const open = store.requests.some(
      (r) => r.squadId === input.squadId && r.userId === input.userId && isOpen(r.status),
    );
    if (open) return null;
    const row: SquadJoinRequest = {
      id: randomUUID(),
      guildId: input.guildId,
      squadId: input.squadId,
      userId: input.userId,
      messageId: null,
      status: input.status,
      invitedBy: input.invitedBy ?? null,
      threadId: null,
      inviteMessageId: null,
      sessionId: input.sessionId ?? null,
      acceptedIds: [],
      declinedIds: [],
      decidedBy: null,
      expiresAt: input.expiresAt,
      createdAt: stamp(),
      decidedAt: null,
    };
    store.requests.push(row);
    return copy(row);
  },
  async setSquadJoinRequestMessage(
    _db: unknown,
    guildId: string,
    requestId: string,
    messageId: string,
  ) {
    const row = findRequest(guildId, requestId);
    if (!row) return null;
    row.messageId = messageId;
    return copy(row);
  },
  async setSquadJoinRequestInvite(
    _db: unknown,
    guildId: string,
    requestId: string,
    input: { threadId: string; inviteMessageId: string },
  ) {
    const row = findRequest(guildId, requestId);
    if (!row) return null;
    Object.assign(row, input);
    return copy(row);
  },
  async getSquadJoinRequest(_db: unknown, guildId: string, requestId: string) {
    return maybe(findRequest(guildId, requestId));
  },
  async startSquadJoinVote(_db: unknown, guildId: string, requestId: string, expiresAt: Date) {
    const row = findRequest(guildId, requestId);
    if (row?.status !== 'invited') return null;
    row.status = 'pending';
    row.expiresAt = expiresAt;
    return copy(row);
  },
  async voteSquadJoinRequest(
    _db: unknown,
    guildId: string,
    requestId: string,
    userId: string,
    inFavor: boolean,
  ) {
    const row = findRequest(guildId, requestId);
    const target = inFavor ? row?.acceptedIds : row?.declinedIds;
    if (row?.status !== 'pending' || target?.includes(userId)) return null;
    if (inFavor) {
      row.acceptedIds = [...row.acceptedIds, userId];
      row.declinedIds = row.declinedIds.filter((id) => id !== userId);
    } else {
      row.declinedIds = [...row.declinedIds, userId];
      row.acceptedIds = row.acceptedIds.filter((id) => id !== userId);
    }
    return copy(row);
  },
  async decideSquadJoinRequest(
    _db: unknown,
    guildId: string,
    requestId: string,
    input: {
      status: 'accepted' | 'declined' | 'expired';
      decidedBy: string | null;
      at: Date;
      from?: readonly SquadOpenRequestStatus[];
    },
  ) {
    const row = findRequest(guildId, requestId);
    const from: readonly string[] = input.from ?? SQUAD_OPEN_REQUEST_STATUSES;
    if (!row || !from.includes(row.status)) return null;
    row.status = input.status;
    row.decidedBy = input.decidedBy;
    row.decidedAt = input.at;
    return copy(row);
  },
  async listOpenJoinRequests(_db: unknown, guildId: string, squadId?: string) {
    return copy(
      store.requests.filter(
        (r) => r.guildId === guildId && isOpen(r.status) && (!squadId || r.squadId === squadId),
      ),
    );
  },
  async listDueJoinRequests(_db: unknown, guildId: string, now: Date) {
    return copy(
      store.requests
        .filter(
          (r) =>
            r.guildId === guildId && isOpen(r.status) && r.expiresAt.getTime() <= now.getTime(),
        )
        .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime()),
    );
  },
  async listRecentJoinRequestsFor(
    _db: unknown,
    guildId: string,
    squadId: string,
    userId: string,
    since: Date,
  ) {
    return copy(
      store.requests
        .filter(
          (r) =>
            r.guildId === guildId &&
            r.squadId === squadId &&
            r.userId === userId &&
            r.createdAt.getTime() >= since.getTime(),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    );
  },
  async listRecentJoinRequestKeys(_db: unknown, guildId: string, since: Date) {
    const keys = new Set<string>();
    for (const r of store.requests) {
      if (r.guildId === guildId && r.createdAt.getTime() >= since.getTime()) {
        keys.add(joinRequestKey(r.squadId, r.userId));
      }
    }
    return [...keys];
  },

  // ── sessões
  async createSquadSession(
    _db: unknown,
    input: {
      guildId: string;
      squadId: string;
      startsAt: Date;
      endsAt: Date;
      createdBy: string;
      goingIds: string[];
    },
  ) {
    const taken = store.sessions.some(
      (s) => s.squadId === input.squadId && s.startsAt.getTime() === input.startsAt.getTime(),
    );
    if (taken) return null;
    const row = blankSession({ ...input });
    store.sessions.push(row);
    return copy(row);
  },
  async getSquadSessionAt(_db: unknown, guildId: string, squadId: string, startsAt: Date) {
    return maybe(
      store.sessions.find(
        (s) =>
          s.guildId === guildId &&
          s.squadId === squadId &&
          s.startsAt.getTime() === startsAt.getTime(),
      ),
    );
  },
  async reopenSquadSession(
    _db: unknown,
    guildId: string,
    sessionId: number,
    input: { endsAt: Date; createdBy: string; goingIds: string[] },
  ) {
    const row = findSession(guildId, sessionId);
    if (!row || !row.cancelledAt || (row.voiceReservedAt && !row.voiceReleasedAt)) return null;
    Object.assign(row, {
      ...input,
      notGoingIds: [],
      remindedAt: null,
      messageId: null,
      startedAt: null,
      playedAt: null,
      reportedAt: null,
      cancelledAt: null,
      cancelledBy: null,
      calledAt: null,
      callChannelId: null,
      callMessageId: null,
      voiceChannelId: null,
      voiceOverwrites: null,
      voiceReservedAt: null,
      voiceReleasedAt: null,
    });
    return copy(row);
  },
  async rescheduleSquadSession(
    _db: unknown,
    guildId: string,
    sessionId: number,
    input: { startsAt: Date; endsAt: Date; resetReminder: boolean },
  ) {
    const row = findSession(guildId, sessionId);
    if (!row || row.startedAt || row.cancelledAt) return { outcome: 'stale' as const };
    if (input.resetReminder && row.voiceReservedAt && !row.voiceReleasedAt) {
      return { outcome: 'stale' as const };
    }
    const taken = store.sessions.some(
      (s) =>
        s.id !== row.id &&
        s.squadId === row.squadId &&
        s.startsAt.getTime() === input.startsAt.getTime(),
    );
    if (taken) return { outcome: 'taken' as const };
    Object.assign(row, { startsAt: input.startsAt, endsAt: input.endsAt });
    if (input.resetReminder) {
      Object.assign(row, {
        remindedAt: null,
        voiceChannelId: null,
        voiceOverwrites: null,
        voiceTemporary: false,
        voiceReservedAt: null,
        voiceReleasedAt: null,
      });
    }
    return { outcome: 'rescheduled' as const, session: copy(row) };
  },
  async listUpcomingSessions(
    _db: unknown,
    guildId: string,
    now: Date,
    options: { squadIds?: readonly string[] } = {},
  ) {
    return copy(
      store.sessions
        .filter(
          (s) =>
            s.guildId === guildId &&
            !s.cancelledAt &&
            s.endsAt.getTime() > now.getTime() &&
            (!options.squadIds || options.squadIds.includes(s.squadId)),
        )
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    );
  },
  async cancelSquadSession(_db: unknown, guildId: string, sessionId: number, by: string, at: Date) {
    const row = findSession(guildId, sessionId);
    if (!row || row.cancelledAt || row.startedAt) return null;
    row.cancelledAt = at;
    row.cancelledBy = by;
    return copy(row);
  },
  async claimSessionCall(_db: unknown, guildId: string, sessionId: number, at: Date) {
    const row = findSession(guildId, sessionId);
    if (!row || row.calledAt || row.startedAt || row.cancelledAt) return null;
    row.calledAt = at;
    return copy(row);
  },
  async setSessionCallMessage(
    _db: unknown,
    guildId: string,
    sessionId: number,
    input: { channelId: string; messageId: string },
  ) {
    const row = findSession(guildId, sessionId);
    if (!row) return null;
    row.callChannelId = input.channelId;
    row.callMessageId = input.messageId;
    return copy(row);
  },
  async releaseSessionCall(_db: unknown, guildId: string, sessionId: number) {
    const row = findSession(guildId, sessionId);
    if (!row || row.callMessageId) return null;
    Object.assign(row, { calledAt: null, callChannelId: null, callMessageId: null });
    return copy(row);
  },
  async closeSessionCall(_db: unknown, guildId: string, sessionId: number, messageId: string) {
    const row = findSession(guildId, sessionId);
    if (row?.callMessageId !== messageId) return null;
    row.callMessageId = null;
    return copy(row);
  },
  async listOpenSessionCalls(_db: unknown, guildId: string, options: { squadId?: string } = {}) {
    return copy(
      store.sessions
        .filter(
          (s) =>
            s.guildId === guildId &&
            s.callMessageId !== null &&
            (!options.squadId || s.squadId === options.squadId),
        )
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    );
  },
  async markSessionPlayed(_db: unknown, guildId: string, sessionId: number, at: Date) {
    const row = findSession(guildId, sessionId);
    if (!row || row.playedAt || row.cancelledAt) return null;
    row.playedAt = at;
    return copy(row);
  },
  async getSquadSession(_db: unknown, guildId: string, sessionId: number) {
    return maybe(findSession(guildId, sessionId));
  },
  async listSessionsStartingBetween(_db: unknown, guildId: string, from: Date, to: Date) {
    return copy(
      store.sessions.filter(
        (s) =>
          s.guildId === guildId &&
          s.startsAt.getTime() >= from.getTime() &&
          s.startsAt.getTime() < to.getTime(),
      ),
    );
  },
  async markSessionReminded(
    _db: unknown,
    guildId: string,
    sessionId: number,
    at: Date,
    guard: { startsBy?: Date } = {},
  ) {
    const row = findSession(guildId, sessionId);
    if (!row || row.remindedAt) return null;
    if (guard.startsBy && row.startsAt.getTime() > guard.startsBy.getTime()) return null;
    row.remindedAt = at;
    return copy(row);
  },
  async setSessionMessage(_db: unknown, guildId: string, sessionId: number, messageId: string) {
    const row = findSession(guildId, sessionId);
    if (!row) return null;
    row.messageId = messageId;
    return copy(row);
  },
  async markSessionStarted(
    _db: unknown,
    guildId: string,
    sessionId: number,
    at: Date,
    guard: { startsBy?: Date } = {},
  ) {
    const row = findSession(guildId, sessionId);
    if (!row || row.startedAt || row.cancelledAt) return null;
    if (guard.startsBy && row.startsAt.getTime() > guard.startsBy.getTime()) return null;
    row.startedAt = at;
    return copy(row);
  },
  async voteSquadSession(
    _db: unknown,
    guildId: string,
    sessionId: number,
    userId: string,
    going: boolean,
  ) {
    const row = findSession(guildId, sessionId);
    const target = going ? row?.goingIds : row?.notGoingIds;
    if (!row || row.cancelledAt || target?.includes(userId)) return null;
    if (going) {
      row.goingIds = [...row.goingIds, userId];
      row.notGoingIds = row.notGoingIds.filter((id) => id !== userId);
    } else {
      row.notGoingIds = [...row.notGoingIds, userId];
      row.goingIds = row.goingIds.filter((id) => id !== userId);
    }
    return copy(row);
  },
  async reserveSessionVoice(
    _db: unknown,
    guildId: string,
    sessionId: number,
    input: {
      voiceChannelId: string | null;
      overwrites: LockOverwrite[] | null;
      temporary?: boolean;
      at: Date;
    },
  ) {
    const row = findSession(guildId, sessionId);
    if (!row || row.voiceReservedAt) return null;
    row.voiceChannelId = input.voiceChannelId;
    row.voiceOverwrites = input.overwrites;
    row.voiceTemporary = input.temporary ?? false;
    row.voiceReservedAt = input.at;
    return copy(row);
  },
  async appendSessionVoiceSnapshot(
    _db: unknown,
    guildId: string,
    sessionId: number,
    entry: LockOverwrite,
  ) {
    const row = findSession(guildId, sessionId);
    if (!row || !row.voiceReservedAt || row.voiceReleasedAt || !row.voiceOverwrites) return null;
    if (!row.voiceOverwrites.some((overwrite) => overwrite.id === entry.id)) {
      row.voiceOverwrites = [...row.voiceOverwrites, { ...entry }];
    }
    return copy(row);
  },
  async setSessionTemporaryVoice(
    _db: unknown,
    guildId: string,
    sessionId: number,
    voiceChannelId: string,
  ) {
    const row = findSession(guildId, sessionId);
    if (
      !row ||
      !row.voiceTemporary ||
      !row.voiceReservedAt ||
      row.voiceReleasedAt ||
      row.voiceChannelId
    ) {
      return null;
    }
    row.voiceChannelId = voiceChannelId;
    return copy(row);
  },
  async listPendingTemporaryVoices(_db: unknown, guildId: string, from: Date, to: Date) {
    return copy(
      store.sessions
        .filter(
          (s) =>
            s.guildId === guildId &&
            s.voiceTemporary &&
            !s.voiceChannelId &&
            s.voiceReservedAt &&
            s.voiceReservedAt >= from &&
            s.voiceReservedAt <= to,
        )
        .sort((a, b) => a.voiceReservedAt!.getTime() - b.voiceReservedAt!.getTime()),
    );
  },
  async listLiveTemporaryVoiceIds(_db: unknown, guildId: string) {
    return store.sessions
      .filter(
        (s) =>
          s.guildId === guildId &&
          s.voiceTemporary &&
          s.voiceReservedAt &&
          !s.voiceReleasedAt &&
          s.voiceChannelId,
      )
      .map((s) => s.voiceChannelId as string);
  },
  async releaseSessionVoice(_db: unknown, guildId: string, sessionId: number, at: Date) {
    const row = findSession(guildId, sessionId);
    if (!row || !row.voiceReservedAt || row.voiceReleasedAt) return null;
    row.voiceReleasedAt = at;
    return copy(row);
  },
  async getActiveSessionByVoice(_db: unknown, guildId: string, voiceChannelId: string, now: Date) {
    const found = store.sessions
      .filter(
        (s) =>
          s.guildId === guildId &&
          s.voiceChannelId === voiceChannelId &&
          s.voiceReservedAt &&
          !s.voiceReleasedAt &&
          s.startsAt.getTime() - HOUR_MS <= now.getTime() &&
          now.getTime() < s.endsAt.getTime(),
      )
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    return maybe(found[0]);
  },
  async listSessionsToReport(
    _db: unknown,
    guildId: string,
    options: { now: Date; since: Date },
  ) {
    return copy(
      store.sessions
        .filter(
          (s) =>
            s.guildId === guildId &&
            s.startedAt !== null &&
            s.reportedAt === null &&
            s.cancelledAt === null &&
            s.startsAt.getTime() >= options.since.getTime() &&
            (s.endsAt.getTime() <= options.now.getTime() ||
              (s.voiceReleasedAt !== null &&
                s.voiceReleasedAt.getTime() >= s.startedAt.getTime())) &&
            !store.attendance.some((a) => a.sessionId === s.id && a.leftAt === null),
        )
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    );
  },
  async markSessionReported(_db: unknown, guildId: string, sessionId: number, at: Date) {
    const row = findSession(guildId, sessionId);
    if (!row || row.reportedAt || row.cancelledAt) return null;
    row.reportedAt = at;
    return copy(row);
  },
  // ── histórico
  async listPlayedSessions(
    _db: unknown,
    guildId: string,
    squadIds: readonly string[],
    since: Date,
  ) {
    return copy(
      store.sessions
        .filter(
          (s) =>
            s.guildId === guildId &&
            squadIds.includes(s.squadId) &&
            s.playedAt !== null &&
            s.cancelledAt === null &&
            s.startsAt.getTime() >= since.getTime(),
        )
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    );
  },
  async listPlayedSessionsByGame(_db: unknown, guildId: string, gameId: string, since: Date) {
    const squadIds = store.squads
      .filter((s) => s.guildId === guildId && s.gameId === gameId)
      .map((s) => s.id);
    return copy(
      store.sessions
        .filter(
          (s) =>
            s.guildId === guildId &&
            squadIds.includes(s.squadId) &&
            s.playedAt !== null &&
            s.cancelledAt === null &&
            s.startsAt.getTime() >= since.getTime(),
        )
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    );
  },
  async countPlayedSessions(_db: unknown, guildId: string, squadIds: readonly string[]) {
    const totals = new Map<
      string,
      { squadId: string; played: number; lastPlayedAt: Date | null }
    >();
    for (const s of store.sessions) {
      if (s.guildId !== guildId || !squadIds.includes(s.squadId)) continue;
      if (s.playedAt === null || s.cancelledAt !== null) continue;
      const row = totals.get(s.squadId) ?? { squadId: s.squadId, played: 0, lastPlayedAt: null };
      row.played++;
      if (!row.lastPlayedAt || s.startsAt > row.lastPlayedAt) row.lastPlayedAt = s.startsAt;
      totals.set(s.squadId, row);
    }
    return copy([...totals.values()]);
  },
  async openSessionAttendance(
    _db: unknown,
    input: {
      guildId: string;
      sessionId: number;
      userId: string;
      joinedAt: Date;
      asGuest?: boolean;
    },
  ) {
    const taken = store.attendance.some(
      (a) =>
        a.sessionId === input.sessionId &&
        a.userId === input.userId &&
        a.joinedAt.getTime() === input.joinedAt.getTime(),
    );
    if (taken) return false;
    store.attendance.push({ ...input, leftAt: null, asGuest: input.asGuest ?? false });
    return true;
  },
  async closeSessionAttendance(_db: unknown, guildId: string, userId: string, at: Date) {
    let closed = 0;
    for (const a of store.attendance) {
      if (a.guildId === guildId && a.userId === userId && a.leftAt === null) {
        a.leftAt = at;
        closed++;
      }
    }
    return closed;
  },
  async listSessionAttendance(_db: unknown, guildId: string, sessionIds: readonly number[]) {
    return copy(
      store.attendance
        .filter((a) => a.guildId === guildId && sessionIds.includes(a.sessionId))
        .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())
        .map(({ sessionId, userId, joinedAt, leftAt, asGuest }) => ({
          sessionId,
          userId,
          joinedAt,
          leftAt,
          asGuest,
        })),
    );
  },
  async listOpenAttendance(_db: unknown, guildId: string) {
    return copy(
      store.attendance
        .filter((a) => a.guildId === guildId && a.leftAt === null)
        .map(({ sessionId, userId, joinedAt }) => ({
          sessionId,
          userId,
          joinedAt,
          voiceChannelId: findSession(guildId, sessionId)?.voiceChannelId ?? null,
        })),
    );
  },
  async closeAttendanceRow(
    _db: unknown,
    guildId: string,
    row: { sessionId: number; userId: string; joinedAt: Date },
    at: Date,
  ) {
    const found = store.attendance.find(
      (a) =>
        a.guildId === guildId &&
        a.sessionId === row.sessionId &&
        a.userId === row.userId &&
        a.joinedAt.getTime() === row.joinedAt.getTime() &&
        a.leftAt === null,
    );
    if (!found) return false;
    found.leftAt = at;
    return true;
  },

  // ── convidados
  async addSessionGuest(
    _db: unknown,
    input: {
      guildId: string;
      sessionId: number;
      userId: string;
      invitedBy: string;
      max: number;
      now: Date;
    },
  ) {
    const session = findSession(input.guildId, input.sessionId);
    if (!session || session.cancelledAt || isSessionOver(session, input.now.getTime())) {
      return { outcome: 'closed' as const };
    }
    const guests = store.guests.filter(
      (g) => g.guildId === input.guildId && g.sessionId === input.sessionId,
    );
    if (guests.some((g) => g.userId === input.userId)) return { outcome: 'exists' as const };
    if (guests.length >= input.max) return { outcome: 'full' as const };
    const guest: SquadSessionGuest = {
      guildId: input.guildId,
      sessionId: input.sessionId,
      userId: input.userId,
      invitedBy: input.invitedBy,
      threadId: null,
      invitedAt: input.now,
    };
    store.guests.push(guest);
    return { outcome: 'added' as const, guest: copy(guest) };
  },
  async setSessionGuestThread(
    _db: unknown,
    guildId: string,
    sessionId: number,
    userId: string,
    threadId: string,
  ) {
    const row = store.guests.find(
      (g) => g.guildId === guildId && g.sessionId === sessionId && g.userId === userId,
    );
    if (!row) return null;
    row.threadId = threadId;
    return copy(row);
  },
  async removeSessionGuest(_db: unknown, guildId: string, sessionId: number, userId: string) {
    const index = store.guests.findIndex(
      (g) => g.guildId === guildId && g.sessionId === sessionId && g.userId === userId,
    );
    if (index < 0) return false;
    store.guests.splice(index, 1);
    return true;
  },
  async listSessionGuests(_db: unknown, guildId: string, sessionIds: readonly number[]) {
    return copy(
      store.guests
        .filter((g) => g.guildId === guildId && sessionIds.includes(g.sessionId))
        .sort((a, b) => a.invitedAt.getTime() - b.invitedAt.getTime()),
    );
  },

  async listSessionsToRelease(_db: unknown, guildId: string, now: Date) {
    return copy(
      store.sessions.filter(
        (s) =>
          s.guildId === guildId &&
          s.voiceReservedAt &&
          !s.voiceReleasedAt &&
          s.endsAt.getTime() <= now.getTime(),
      ),
    );
  },
};

type Repositories = { [K in keyof typeof impl]: Mock<(typeof impl)[K]> };

/** O que o `vi.mock('@goodbot/db')` devolve: cada função é um `vi.fn` sobre `impl`. */
export const repositories = Object.fromEntries(
  Object.entries(impl).map(([name, fn]) => [name, vi.fn(fn)]),
) as Repositories;

/**
 * `db.transaction` com rollback de verdade sobre o store: o que a transação
 * escreveu some quando ela lança (inclusive por `tx.rollback()`).
 */
export const fakeDb = {
  async transaction<T>(run: (tx: { rollback: () => never }) => Promise<T>): Promise<T> {
    const before = hooks.beforeTransaction;
    delete hooks.beforeTransaction;
    before?.();
    const snapshot = structuredClone(store);
    try {
      return await run({
        rollback: () => {
          throw new TransactionRollbackError();
        },
      });
    } catch (error) {
      Object.assign(store, snapshot);
      throw error;
    }
  },
} as unknown as Db;

// ── sementes ────────────────────────────────────────────────────────────────

function blankSession(input: Partial<SquadSession> & Pick<SquadSession, 'squadId'>): SquadSession {
  return {
    id: ++sessionSeq,
    guildId: GUILD_ID,
    startsAt: new Date(clock() + 30 * MINUTE_MS),
    endsAt: new Date(clock() + 3 * HOUR_MS),
    createdBy: null,
    remindedAt: null,
    messageId: null,
    startedAt: null,
    goingIds: [],
    notGoingIds: [],
    voiceChannelId: null,
    voiceOverwrites: null,
    voiceTemporary: false,
    voiceReservedAt: null,
    voiceReleasedAt: null,
    playedAt: null,
    reportedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    calledAt: null,
    callChannelId: null,
    callMessageId: null,
    createdAt: stamp(),
    ...input,
  };
}

export function seedGame(overrides: Partial<SquadGame> = {}): SquadGame {
  const game: SquadGame = {
    id: randomUUID(),
    guildId: GUILD_ID,
    name: 'Helldivers 2',
    groupSize: 4,
    partySize: 4,
    enabled: true,
    fields: [
      {
        key: 'platform',
        label: 'Plataforma',
        type: 'select',
        options: ['PC', 'PS5'],
        required: true,
        match: 'hard',
      },
    ],
    createdAt: stamp(),
    updatedAt: stamp(),
    ...overrides,
  };
  store.games.push(game);
  return game;
}

export function seedProfile(
  input: Partial<SquadProfile> & Pick<SquadProfile, 'userId' | 'gameId'>,
): SquadProfile {
  const profile: SquadProfile = {
    guildId: GUILD_ID,
    availability: 0,
    answers: { platform: 'PC' },
    status: 'searching',
    lastMatchedAt: null,
    createdAt: stamp(),
    updatedAt: stamp(),
    ...input,
  };
  store.profiles.push(profile);
  return profile;
}

export function seedSquad(input: Partial<Squad> & Pick<Squad, 'gameId'>): Squad {
  const squad: Squad = {
    id: randomUUID(),
    guildId: GUILD_ID,
    name: 'Squad Teste',
    textChannelId: null,
    voiceChannelId: null,
    guideMessageId: null,
    status: 'open',
    lastConfirmedAt: null,
    warnedAt: null,
    archivedAt: null,
    createdAt: stamp(),
    updatedAt: stamp(),
    ...input,
  };
  store.squads.push(squad);
  return squad;
}

export function seedMember(squadId: string, userId: string): SquadMember {
  const member: SquadMember = { guildId: GUILD_ID, squadId, userId, joinedAt: stamp() };
  store.members.push(member);
  return member;
}

export function seedProposal(
  input: Partial<SquadProposal> & Pick<SquadProposal, 'gameId' | 'userIds' | 'threadId'>,
): SquadProposal {
  const proposal: SquadProposal = {
    id: randomUUID(),
    guildId: GUILD_ID,
    messageId: null,
    acceptedIds: [],
    declinedIds: [],
    squadId: null,
    expiresAt: new Date(clock() + 72 * HOUR_MS),
    closedAt: null,
    createdAt: stamp(),
    ...input,
  };
  store.proposals.push(proposal);
  return proposal;
}

export function seedSession(
  input: Partial<SquadSession> & Pick<SquadSession, 'squadId'>,
): SquadSession {
  const session = blankSession(input);
  store.sessions.push(session);
  return session;
}
