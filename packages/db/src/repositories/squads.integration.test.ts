import { joinRequestKey, pairKey } from '@goodbot/shared';
import { eq, inArray, TransactionRollbackError } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Db } from '../client';
import { loadRootEnv } from '../env';
import {
  acceptSquadProposal,
  addSessionGuest,
  addSquadMember,
  appendSessionVoiceSnapshot,
  archiveSquad,
  cancelSquadSession,
  claimProposalSquad,
  claimSessionCall,
  closeAttendanceRow,
  closeSessionAttendance,
  closeSessionCall,
  closeSquadProposal,
  countPlayedSessions,
  countSearchingProfilesByGame,
  countSquadsForUser,
  createSquad,
  createSquadGame,
  createSquadJoinRequest,
  createSquadProposal,
  createSquadSession,
  declineSquadProposal,
  decideSquadJoinRequest,
  deleteSquadProfile,
  getActiveSessionByVoice,
  getSquad,
  getSquadJoinRequest,
  getSquadProposal,
  getSquadSessionAt,
  listDueJoinRequests,
  listInactiveSquads,
  listMembersOfSquads,
  listOpenAttendance,
  listOpenJoinRequests,
  listOpenSessionCalls,
  listPlayedSessions,
  listRecentJoinRequestKeys,
  listRecentJoinRequestsFor,
  listRecentProposalPairs,
  listSessionAttendance,
  listSessionGuests,
  listSessionsToRelease,
  listSessionsToReport,
  listSquadProfilesByGame,
  listSquads,
  listSquadsForUser,
  listUpcomingSessions,
  markSessionPlayed,
  markSessionReminded,
  markSessionReported,
  markSessionStarted,
  openSessionAttendance,
  releaseSessionCall,
  releaseSessionVoice,
  removeSessionGuest,
  reopenSquadSession,
  rescheduleSquadSession,
  reserveSessionVoice,
  setSessionCallMessage,
  setSessionGuestThread,
  setSessionMessage,
  setSquadGuideMessage,
  setSquadStatus,
  startSquadJoinVote,
  syncSquadStatusesToGroupSize,
  touchSquadConfirmed,
  upsertSquadProfile,
  voteSquadJoinRequest,
  voteSquadSession,
} from './squads';
import { guilds } from '../schema/guilds';
import { squadJoinRequests, squadProposals, squads } from '../schema/squads';

import type { LockOverwrite } from '../schema/misc';
import type { SquadGame } from '../types';

loadRootEnv();
const url = process.env.DATABASE_URL;

// Guilds fictícias (snowflakes válidos) para isolar o teste; removidas no fim,
// e o cascade leva junto tudo o que o módulo gravou.
const GUILD_ID = `7${String(Date.now()).padStart(17, '0')}`;
const OTHER_GUILD_ID = `6${String(Date.now()).padStart(17, '0')}`;
const USER_A = '200000000000000001';
const USER_B = '200000000000000002';
const USER_C = '200000000000000003';
const USER_D = '200000000000000004';
const USER_E = '200000000000000005';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let nextThread = 0;
/** Thread única por proposta (a unique `(guild_id, thread_id)`). */
function threadId(): string {
  nextThread += 1;
  return `5${String(Date.now()).slice(-12)}${String(nextThread).padStart(5, '0')}`;
}

describe.skipIf(!url)('squads repositories (integração com Postgres)', () => {
  let db: Db;
  let end: () => Promise<void>;
  let game: SquadGame;

  const newSquad = (name: string) => createSquad(db, { guildId: GUILD_ID, gameId: game.id, name });

  const newProposal = (userIds: string[], gameId = game.id) =>
    createSquadProposal(db, {
      guildId: GUILD_ID,
      gameId,
      userIds,
      threadId: threadId(),
      expiresAt: new Date(Date.now() + 72 * HOUR),
    });

  beforeAll(async () => {
    const client = createDb(url!, { max: 3 });
    db = client.db;
    end = () => client.sql.end();
    await db.insert(guilds).values([
      { id: GUILD_ID, name: 'Teste squads', ownerId: USER_A },
      { id: OTHER_GUILD_ID, name: 'Outra guild', ownerId: USER_A },
    ]);
    const created = await createSquadGame(db, {
      guildId: GUILD_ID,
      name: 'Helldivers 2',
      groupSize: 4,
      partySize: 4,
    });
    if (!created) throw new Error('jogo de teste não foi criado');
    game = created;
  });

  afterAll(async () => {
    await db.delete(guilds).where(inArray(guilds.id, [GUILD_ID, OTHER_GUILD_ID]));
    await end();
  });

  describe('jogos e escopo de guild', () => {
    it('nome repetido na guild devolve null', async () => {
      expect(
        await createSquadGame(db, {
          guildId: GUILD_ID,
          name: 'Helldivers 2',
          groupSize: 2,
          partySize: 2,
        }),
      ).toBeNull();
    });

    it('um uuid de outra guild não alcança o squad nem a proposta', async () => {
      const squad = await newSquad('Escopo');
      const proposal = await newProposal([USER_A, USER_B]);
      expect(await getSquad(db, OTHER_GUILD_ID, squad.id)).toBeNull();
      expect(await acceptSquadProposal(db, OTHER_GUILD_ID, proposal.id, USER_A)).toBeNull();
      expect(await claimProposalSquad(db, OTHER_GUILD_ID, proposal.id, squad.id)).toBeNull();
    });
  });

  describe('perfis', () => {
    /** Jogo próprio por teste: os contadores dos outros blocos olham o jogo principal. */
    async function profileGame(guildId: string, name: string): Promise<SquadGame> {
      const created = await createSquadGame(db, { guildId, name, groupSize: 3, partySize: 3 });
      if (!created) throw new Error(`jogo de teste ${name} não foi criado`);
      return created;
    }

    const upsert = (
      guildId: string,
      gameId: string,
      userId: string,
      status: 'searching' | 'in_squad' | 'paused' = 'searching',
    ) => upsertSquadProfile(db, { guildId, gameId, userId, availability: 1, answers: {}, status });

    it('lista todos os status do jogo, só da guild, e filtra por userIds', async () => {
      const own = await profileGame(GUILD_ID, 'Perfis');
      const foreign = await profileGame(OTHER_GUILD_ID, 'Perfis');
      await upsert(GUILD_ID, own.id, USER_C, 'paused');
      await upsert(GUILD_ID, own.id, USER_A, 'searching');
      await upsert(GUILD_ID, own.id, USER_B, 'in_squad');
      await upsert(OTHER_GUILD_ID, foreign.id, USER_D);

      const all = await listSquadProfilesByGame(db, GUILD_ID, own.id);
      expect(all.map((profile) => [profile.userId, profile.status])).toEqual([
        [USER_A, 'searching'],
        [USER_B, 'in_squad'],
        [USER_C, 'paused'],
      ]);
      expect(await listSquadProfilesByGame(db, OTHER_GUILD_ID, own.id)).toEqual([]);
      const picked = await listSquadProfilesByGame(db, GUILD_ID, own.id, {
        userIds: [USER_C, USER_A, USER_E],
      });
      expect(picked.map((profile) => profile.userId)).toEqual([USER_A, USER_C]);
      expect(await listSquadProfilesByGame(db, GUILD_ID, own.id, { userIds: [] })).toEqual([]);
    });

    it('apagar devolve a linha uma vez e não alcança outra guild', async () => {
      const own = await profileGame(GUILD_ID, 'Apagar perfil');
      await upsert(GUILD_ID, own.id, USER_A);
      await upsert(GUILD_ID, own.id, USER_B);

      expect(await deleteSquadProfile(db, OTHER_GUILD_ID, USER_A, own.id)).toBeNull();
      expect(await deleteSquadProfile(db, GUILD_ID, USER_A, own.id)).toMatchObject({
        guildId: GUILD_ID,
        userId: USER_A,
        gameId: own.id,
      });
      expect(await deleteSquadProfile(db, GUILD_ID, USER_A, own.id)).toBeNull();
      const left = await listSquadProfilesByGame(db, GUILD_ID, own.id);
      expect(left.map((profile) => profile.userId)).toEqual([USER_B]);
    });
  });

  describe('pedidos de entrada', () => {
    const inHours = (hours: number) => new Date(Date.now() + hours * HOUR);

    it('um aberto por pessoa e squad, convite ou votação; depois de decidido, pode de novo', async () => {
      const squad = await newSquad('Pedidos');
      const base = { guildId: GUILD_ID, squadId: squad.id, userId: USER_B, expiresAt: inHours(72) };

      const first = await createSquadJoinRequest(db, { ...base, status: 'invited' });
      expect(first?.status).toBe('invited');
      expect(await createSquadJoinRequest(db, { ...base, status: 'pending' })).toBeNull();

      const decided = await decideSquadJoinRequest(db, GUILD_ID, first!.id, {
        status: 'declined',
        decidedBy: USER_B,
        at: new Date(),
      });
      expect(decided?.status).toBe('declined');
      // O job expira o convite logo depois: ele já foi decidido.
      expect(
        await decideSquadJoinRequest(db, GUILD_ID, first!.id, {
          status: 'expired',
          decidedBy: null,
          at: new Date(),
        }),
      ).toBeNull();

      const again = await createSquadJoinRequest(db, { ...base, status: 'pending' });
      expect(again).not.toBeNull();
      expect(again?.id).not.toBe(first?.id);
      expect((await listOpenJoinRequests(db, GUILD_ID, squad.id)).map((r) => r.id)).toEqual([
        again?.id,
      ]);
      expect(
        (await listRecentJoinRequestsFor(db, GUILD_ID, squad.id, USER_B, inHours(-1))).map(
          (r) => r.status,
        ),
      ).toEqual(['pending', 'declined']);
    });

    it('startSquadJoinVote só sai de invited, e decide respeita o from', async () => {
      const squad = await newSquad('Fases');
      const invite = await createSquadJoinRequest(db, {
        guildId: GUILD_ID,
        squadId: squad.id,
        userId: USER_C,
        status: 'invited',
        invitedBy: USER_A,
        expiresAt: inHours(1),
      });
      const id = invite!.id;
      expect(invite?.invitedBy).toBe(USER_A);

      const voting = await startSquadJoinVote(db, GUILD_ID, id, inHours(72));
      expect(voting?.status).toBe('pending');
      expect(voting?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 71 * HOUR);
      expect(await startSquadJoinVote(db, GUILD_ID, id, inHours(72))).toBeNull();

      expect(
        await decideSquadJoinRequest(db, GUILD_ID, id, {
          status: 'expired',
          decidedBy: null,
          at: new Date(),
          from: ['invited'],
        }),
      ).toBeNull();
      expect((await getSquadJoinRequest(db, GUILD_ID, id))?.status).toBe('pending');
    });

    it('voteSquadJoinRequest não repete o voto, troca de lado e para depois da decisão', async () => {
      const squad = await newSquad('Votos');
      const request = await createSquadJoinRequest(db, {
        guildId: GUILD_ID,
        squadId: squad.id,
        userId: USER_D,
        status: 'pending',
        expiresAt: inHours(72),
      });
      const id = request!.id;

      expect((await voteSquadJoinRequest(db, GUILD_ID, id, USER_A, false))?.declinedIds).toEqual([
        USER_A,
      ]);
      expect(await voteSquadJoinRequest(db, GUILD_ID, id, USER_A, false)).toBeNull();
      const switched = await voteSquadJoinRequest(db, GUILD_ID, id, USER_A, true);
      expect(switched).toMatchObject({ acceptedIds: [USER_A], declinedIds: [] });
      expect((await voteSquadJoinRequest(db, GUILD_ID, id, USER_B, false))?.declinedIds).toEqual([
        USER_B,
      ]);

      await decideSquadJoinRequest(db, GUILD_ID, id, {
        status: 'accepted',
        decidedBy: USER_A,
        at: new Date(),
      });
      expect(await voteSquadJoinRequest(db, GUILD_ID, id, USER_C, true)).toBeNull();
      expect(await getSquadJoinRequest(db, GUILD_ID, id)).toMatchObject({
        acceptedIds: [USER_A],
        declinedIds: [USER_B],
      });
    });

    it('listDueJoinRequests: só os abertos com prazo vencido, só da guild', async () => {
      const squad = await newSquad('Prazos');
      const make = (userId: string, status: 'invited' | 'pending', hours: number) =>
        createSquadJoinRequest(db, {
          guildId: GUILD_ID,
          squadId: squad.id,
          userId,
          status,
          expiresAt: inHours(hours),
        });
      const invited = await make(USER_A, 'invited', -1);
      const pending = await make(USER_B, 'pending', -2);
      await make(USER_C, 'pending', 5);
      const closed = await make(USER_D, 'invited', -3);
      await decideSquadJoinRequest(db, GUILD_ID, closed!.id, {
        status: 'declined',
        decidedBy: USER_D,
        at: new Date(),
      });

      const due = await listDueJoinRequests(db, GUILD_ID, new Date());
      expect(due.filter((r) => r.squadId === squad.id).map((r) => r.id)).toEqual([
        pending?.id,
        invited?.id,
      ]);
      expect(await listDueJoinRequests(db, OTHER_GUILD_ID, new Date())).toEqual([]);
    });

    it('listRecentJoinRequestKeys: qualquer status desde since, sem repetir, só da guild', async () => {
      const squad = await newSquad('Chaves');
      const base = { guildId: GUILD_ID, squadId: squad.id, expiresAt: inHours(72) };
      const first = await createSquadJoinRequest(db, {
        ...base,
        userId: USER_C,
        status: 'pending',
      });
      await decideSquadJoinRequest(db, GUILD_ID, first!.id, {
        status: 'declined',
        decidedBy: USER_A,
        at: new Date(),
      });
      await createSquadJoinRequest(db, { ...base, userId: USER_C, status: 'invited' });
      const old = await createSquadJoinRequest(db, { ...base, userId: USER_E, status: 'pending' });
      await db
        .update(squadJoinRequests)
        .set({ createdAt: new Date(Date.now() - 30 * DAY) })
        .where(eq(squadJoinRequests.id, old!.id));

      const since = new Date(Date.now() - 14 * DAY);
      const keys = await listRecentJoinRequestKeys(db, GUILD_ID, since);
      expect(keys.filter((key) => key.startsWith(squad.id))).toEqual([
        joinRequestKey(squad.id, USER_C),
      ]);
      expect(await listRecentJoinRequestKeys(db, OTHER_GUILD_ID, since)).toEqual([]);
    });
  });

  describe('propostas', () => {
    it('claimProposalSquad: só o primeiro aceite amarra o squad', async () => {
      const proposal = await newProposal([USER_A, USER_B, USER_C]);
      const first = await newSquad('Primeiro');
      const second = await newSquad('Segundo');

      expect((await claimProposalSquad(db, GUILD_ID, proposal.id, first.id))?.squadId).toBe(
        first.id,
      );
      expect(await claimProposalSquad(db, GUILD_ID, proposal.id, second.id)).toBeNull();
      expect((await getSquadProposal(db, GUILD_ID, proposal.id))?.squadId).toBe(first.id);
    });

    it('dois aceites simultâneos em transação deixam um squad só', async () => {
      const proposal = await newProposal([USER_A, USER_B]);
      // O desenho que a Etapa 3 usa: inserir o squad e reivindicar na mesma
      // transação; quem perde faz rollback e o squad dele some.
      const attempt = (name: string) =>
        db
          .transaction(async (tx) => {
            const squad = await createSquad(tx, {
              guildId: GUILD_ID,
              gameId: game.id,
              name,
            });
            const claimed = await claimProposalSquad(tx, GUILD_ID, proposal.id, squad.id);
            if (!claimed) tx.rollback();
            return squad.id;
          })
          .catch((error: unknown) => {
            if (error instanceof TransactionRollbackError) return null;
            throw error;
          });

      const results = await Promise.all([attempt('Corrida A'), attempt('Corrida B')]);
      const winners = results.filter((id): id is string => id !== null);
      expect(winners).toHaveLength(1);
      expect((await getSquadProposal(db, GUILD_ID, proposal.id))?.squadId).toBe(winners[0]);
      const raced = (await listSquads(db, GUILD_ID, { gameId: game.id })).filter((squad) =>
        squad.name.startsWith('Corrida'),
      );
      expect(raced.map((squad) => squad.id)).toEqual(winners);
    });

    it('aceitar e recusar trocam de lista sem duplicar', async () => {
      const proposal = await newProposal([USER_A, USER_B, USER_C]);
      const id = proposal.id;

      let row = await acceptSquadProposal(db, GUILD_ID, id, USER_A);
      expect(row?.acceptedIds).toEqual([USER_A]);
      expect(await acceptSquadProposal(db, GUILD_ID, id, USER_A)).toBeNull();

      row = await declineSquadProposal(db, GUILD_ID, id, USER_A);
      expect(row?.acceptedIds).toEqual([]);
      expect(row?.declinedIds).toEqual([USER_A]);
      expect(await declineSquadProposal(db, GUILD_ID, id, USER_A)).toBeNull();

      row = await acceptSquadProposal(db, GUILD_ID, id, USER_A);
      expect(row?.acceptedIds).toEqual([USER_A]);
      expect(row?.declinedIds).toEqual([]);

      // Fora da turma não aceita.
      expect(await acceptSquadProposal(db, GUILD_ID, id, USER_D)).toBeNull();

      // Cliques no mesmo instante: nenhum aceite se perde.
      await Promise.all([
        acceptSquadProposal(db, GUILD_ID, id, USER_B),
        acceptSquadProposal(db, GUILD_ID, id, USER_C),
      ]);
      const read = await getSquadProposal(db, GUILD_ID, id);
      expect([...(read?.acceptedIds ?? [])].sort()).toEqual([USER_A, USER_B, USER_C]);

      // Fechada, a proposta não muda mais.
      expect(await closeSquadProposal(db, GUILD_ID, id, new Date())).not.toBeNull();
      expect(await closeSquadProposal(db, GUILD_ID, id, new Date())).toBeNull();
      expect(await declineSquadProposal(db, GUILD_ID, id, USER_B)).toBeNull();
    });

    it('listRecentProposalPairs respeita since e o jogo', async () => {
      const pairsGame = await createSquadGame(db, {
        guildId: GUILD_ID,
        name: 'Jogo das duplas',
        groupSize: 3,
        partySize: 3,
      });
      const otherGame = await createSquadGame(db, {
        guildId: GUILD_ID,
        name: 'Outro jogo',
        groupSize: 2,
        partySize: 2,
      });

      await newProposal([USER_A, USER_B, USER_C], pairsGame!.id);
      // A mesma dupla em outra proposta não repete a chave.
      await newProposal([USER_B, USER_A], pairsGame!.id);
      const old = await newProposal([USER_A, USER_D], pairsGame!.id);
      await db
        .update(squadProposals)
        .set({ createdAt: new Date(Date.now() - 30 * DAY) })
        .where(eq(squadProposals.id, old.id));
      await newProposal([USER_C, USER_D], otherGame!.id);

      const since = new Date(Date.now() - 14 * DAY);
      const pairs = await listRecentProposalPairs(db, GUILD_ID, pairsGame!.id, since);
      expect(pairs.sort()).toEqual(
        [pairKey(USER_A, USER_B), pairKey(USER_A, USER_C), pairKey(USER_B, USER_C)].sort(),
      );

      const withOld = await listRecentProposalPairs(
        db,
        GUILD_ID,
        pairsGame!.id,
        new Date(Date.now() - 60 * DAY),
      );
      expect(withOld).toContain(pairKey(USER_A, USER_D));
      expect(withOld).not.toContain(pairKey(USER_C, USER_D));
    });
  });

  describe('sessões', () => {
    const newSession = async (name: string) => {
      const squad = await newSquad(name);
      const startsAt = new Date(Date.now() + DAY);
      const session = await createSquadSession(db, {
        guildId: GUILD_ID,
        squadId: squad.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * HOUR),
        createdBy: USER_A,
        goingIds: [USER_A],
      });
      if (!session) throw new Error('jogatina não criada');
      return session;
    };

    it('o mesmo minuto não cria duas jogatinas, e o voto troca entre vou e não vou', async () => {
      const session = await newSession('Votos');
      expect(session.goingIds).toEqual([USER_A]);
      expect(
        await createSquadSession(db, {
          guildId: GUILD_ID,
          squadId: session.squadId,
          startsAt: session.startsAt,
          endsAt: session.endsAt,
          createdBy: USER_B,
          goingIds: [USER_B],
        }),
      ).toBeNull();
      expect((await getSquadSessionAt(db, GUILD_ID, session.squadId, session.startsAt))?.id).toBe(
        session.id,
      );
      expect(
        await getSquadSessionAt(db, OTHER_GUILD_ID, session.squadId, session.startsAt),
      ).toBeNull();

      expect(await voteSquadSession(db, GUILD_ID, session.id, USER_A, true)).toBeNull();
      let row = await voteSquadSession(db, GUILD_ID, session.id, USER_A, false);
      expect(row?.goingIds).toEqual([]);
      expect(row?.notGoingIds).toEqual([USER_A]);

      row = await voteSquadSession(db, GUILD_ID, session.id, USER_B, true);
      expect(row?.goingIds).toEqual([USER_B]);
      expect(row?.notGoingIds).toEqual([USER_A]);
    });

    it('cancelar trava votos, some das próximas e reabre no mesmo minuto', async () => {
      const session = await newSession('Cancelar');
      const now = new Date();
      expect(
        (await listUpcomingSessions(db, GUILD_ID, now, { squadIds: [session.squadId] })).map(
          (row) => row.id,
        ),
      ).toEqual([session.id]);

      const cancelled = await cancelSquadSession(db, GUILD_ID, session.id, USER_A, now);
      expect(cancelled?.cancelledBy).toBe(USER_A);
      expect(await cancelSquadSession(db, GUILD_ID, session.id, USER_A, now)).toBeNull();
      expect(await voteSquadSession(db, GUILD_ID, session.id, USER_B, true)).toBeNull();
      expect(await markSessionPlayed(db, GUILD_ID, session.id, now)).toBeNull();
      expect(
        await listUpcomingSessions(db, GUILD_ID, now, { squadIds: [session.squadId] }),
      ).toEqual([]);
      expect(await listUpcomingSessions(db, GUILD_ID, now, { squadIds: [] })).toEqual([]);

      const reopened = await reopenSquadSession(db, GUILD_ID, session.id, {
        endsAt: session.endsAt,
        createdBy: USER_B,
        goingIds: [USER_B],
      });
      expect(reopened).toMatchObject({
        id: session.id,
        cancelledAt: null,
        createdBy: USER_B,
        goingIds: [USER_B],
        notGoingIds: [],
      });
      expect(
        await reopenSquadSession(db, GUILD_ID, session.id, {
          endsAt: session.endsAt,
          createdBy: USER_B,
          goingIds: [USER_B],
        }),
      ).toBeNull();
    });

    it('não reabre enquanto a reserva cancelada ainda segura o voice', async () => {
      const session = await newSession('Reserva presa');
      await reserveSessionVoice(db, GUILD_ID, session.id, {
        voiceChannelId: '400000000000000011',
        overwrites: [],
        at: new Date(),
      });
      await cancelSquadSession(db, GUILD_ID, session.id, USER_A, new Date());
      const input = { endsAt: session.endsAt, createdBy: USER_A, goingIds: [USER_A] };
      expect(await reopenSquadSession(db, GUILD_ID, session.id, input)).toBeNull();
      await releaseSessionVoice(db, GUILD_ID, session.id, new Date());
      expect(
        (await reopenSquadSession(db, GUILD_ID, session.id, input))?.voiceReservedAt,
      ).toBeNull();
    });

    it('remarcar troca o horário, esbarra em minuto ocupado e só zera a reserva devolvida', async () => {
      const session = await newSession('Remarcar');
      const at = (ms: number) => ({
        startsAt: new Date(ms),
        endsAt: new Date(ms + 3 * HOUR),
      });
      const later = at(session.startsAt.getTime() + HOUR);

      const moved = await rescheduleSquadSession(db, GUILD_ID, session.id, {
        ...later,
        resetReminder: false,
      });
      expect(moved).toMatchObject({
        outcome: 'rescheduled',
        session: { id: session.id, ...later, goingIds: [USER_A] },
      });
      expect(
        await rescheduleSquadSession(db, OTHER_GUILD_ID, session.id, {
          ...later,
          resetReminder: false,
        }),
      ).toEqual({ outcome: 'stale' });

      // O minuto antigo ficou livre e outra jogatina o ocupou: voltar para ele esbarra no índice.
      const other = await createSquadSession(db, {
        guildId: GUILD_ID,
        squadId: session.squadId,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        createdBy: USER_B,
        goingIds: [USER_B],
      });
      expect(other).not.toBeNull();
      expect(
        await rescheduleSquadSession(db, GUILD_ID, session.id, {
          ...at(session.startsAt.getTime()),
          resetReminder: false,
        }),
      ).toEqual({ outcome: 'taken' });

      await markSessionReminded(db, GUILD_ID, session.id, new Date());
      await reserveSessionVoice(db, GUILD_ID, session.id, {
        voiceChannelId: '400000000000000012',
        overwrites: [],
        at: new Date(),
      });
      const far = { ...at(session.startsAt.getTime() + DAY), resetReminder: true };
      expect(await rescheduleSquadSession(db, GUILD_ID, session.id, far)).toEqual({
        outcome: 'stale',
      });
      await releaseSessionVoice(db, GUILD_ID, session.id, new Date());
      expect(await rescheduleSquadSession(db, GUILD_ID, session.id, far)).toMatchObject({
        outcome: 'rescheduled',
        session: {
          remindedAt: null,
          voiceChannelId: null,
          voiceOverwrites: null,
          voiceReservedAt: null,
          voiceReleasedAt: null,
        },
      });

      await markSessionStarted(db, GUILD_ID, session.id, new Date());
      expect(
        await rescheduleSquadSession(db, GUILD_ID, session.id, { ...later, resetReminder: false }),
      ).toEqual({ outcome: 'stale' });
    });

    it('lembrar e começar com startsBy só pegam a jogatina que já está na hora', async () => {
      const session = await newSession('Hora certa');
      const now = new Date();
      const early = { startsBy: now };
      const onTime = { startsBy: session.startsAt };

      expect(await markSessionReminded(db, GUILD_ID, session.id, now, early)).toBeNull();
      expect(await markSessionStarted(db, GUILD_ID, session.id, now, early)).toBeNull();
      expect(await markSessionReminded(db, GUILD_ID, session.id, now, onTime)).not.toBeNull();
      expect(await markSessionStarted(db, GUILD_ID, session.id, now, onTime)).not.toBeNull();
    });

    it('jogatina começada não cancela, e rolou marca uma vez', async () => {
      const session = await newSession('Rolou');
      await markSessionStarted(db, GUILD_ID, session.id, new Date());
      expect(await cancelSquadSession(db, GUILD_ID, session.id, USER_A, new Date())).toBeNull();
      expect(await markSessionPlayed(db, GUILD_ID, session.id, new Date())).not.toBeNull();
      expect(await markSessionPlayed(db, GUILD_ID, session.id, new Date())).toBeNull();
    });

    it('lembrete e início acontecem uma vez só', async () => {
      const session = await newSession('Lembrete');
      expect(await markSessionReminded(db, GUILD_ID, session.id, new Date())).not.toBeNull();
      expect(await markSessionReminded(db, GUILD_ID, session.id, new Date())).toBeNull();

      const withMessage = await setSessionMessage(db, GUILD_ID, session.id, '300000000000000001');
      expect(withMessage?.messageId).toBe('300000000000000001');

      expect(await markSessionStarted(db, GUILD_ID, session.id, new Date())).not.toBeNull();
      expect(await markSessionStarted(db, GUILD_ID, session.id, new Date())).toBeNull();
    });

    it('reserva uma vez; a liberação devolve o snapshot e não se repete', async () => {
      const session = await newSession('Voice');
      const overwrites: LockOverwrite[] = [
        { id: GUILD_ID, type: 0, allow: '0', deny: '1048576' },
        { id: USER_A, type: 1, allow: '1024', deny: '0' },
      ];

      const reserved = await reserveSessionVoice(db, GUILD_ID, session.id, {
        voiceChannelId: '400000000000000001',
        overwrites,
        at: new Date(),
      });
      expect(reserved?.voiceChannelId).toBe('400000000000000001');
      expect(reserved?.voiceOverwrites).toEqual(overwrites);
      expect(
        await reserveSessionVoice(db, GUILD_ID, session.id, {
          voiceChannelId: '400000000000000002',
          overwrites: [],
          at: new Date(),
        }),
      ).toBeNull();

      const beforeEnd = await listSessionsToRelease(db, GUILD_ID, new Date());
      expect(beforeEnd.map((row) => row.id)).not.toContain(session.id);
      const afterEnd = new Date(session.endsAt.getTime() + 1_000);
      expect((await listSessionsToRelease(db, GUILD_ID, afterEnd)).map((row) => row.id)).toContain(
        session.id,
      );

      const released = await releaseSessionVoice(db, GUILD_ID, session.id, afterEnd);
      expect(released?.voiceChannelId).toBe('400000000000000001');
      expect(released?.voiceOverwrites).toEqual(overwrites);
      expect(await releaseSessionVoice(db, GUILD_ID, session.id, afterEnd)).toBeNull();
      expect(
        (await listSessionsToRelease(db, GUILD_ID, afterEnd)).map((row) => row.id),
      ).not.toContain(session.id);
    });

    it('o snapshot ganha quem entrou com a reserva viva, uma vez, e só com ela viva e do pool', async () => {
      const session = await newSession('Snapshot');
      const everyone: LockOverwrite = { id: GUILD_ID, type: 0, allow: '0', deny: '0' };
      const late: LockOverwrite = { id: USER_C, type: -1, allow: '0', deny: '0' };
      expect(await appendSessionVoiceSnapshot(db, GUILD_ID, session.id, late)).toBeNull();

      await reserveSessionVoice(db, GUILD_ID, session.id, {
        voiceChannelId: '400000000000000013',
        overwrites: [everyone],
        at: new Date(),
      });
      expect(await appendSessionVoiceSnapshot(db, OTHER_GUILD_ID, session.id, late)).toBeNull();
      const appended = await appendSessionVoiceSnapshot(db, GUILD_ID, session.id, late);
      expect(appended?.voiceOverwrites).toEqual([everyone, late]);

      // A segunda entrada guardaria o overwrite que a própria reserva deu.
      const granted: LockOverwrite = { id: USER_C, type: 1, allow: '3146752', deny: '0' };
      const again = await appendSessionVoiceSnapshot(db, GUILD_ID, session.id, granted);
      expect(again?.voiceOverwrites).toEqual([everyone, late]);

      await releaseSessionVoice(db, GUILD_ID, session.id, new Date());
      const other: LockOverwrite = { id: USER_D, type: -1, allow: '0', deny: '0' };
      expect(await appendSessionVoiceSnapshot(db, GUILD_ID, session.id, other)).toBeNull();

      const temporary = await newSession('Snapshot temporário');
      await reserveSessionVoice(db, GUILD_ID, temporary.id, {
        voiceChannelId: '400000000000000014',
        overwrites: null,
        temporary: true,
        at: new Date(),
      });
      expect(await appendSessionVoiceSnapshot(db, GUILD_ID, temporary.id, late)).toBeNull();
    });

    it('getActiveSessionByVoice: reserva viva, de 60 min antes do início até o fim', async () => {
      const session = await newSession('Voice ativo');
      const voiceId = '400000000000000009';
      const at = (offset: number) => new Date(session.startsAt.getTime() + offset);

      expect(await getActiveSessionByVoice(db, GUILD_ID, voiceId, at(HOUR))).toBeNull();
      await reserveSessionVoice(db, GUILD_ID, session.id, {
        voiceChannelId: voiceId,
        overwrites: [],
        at: new Date(),
      });

      expect(await getActiveSessionByVoice(db, GUILD_ID, voiceId, at(-2 * HOUR))).toBeNull();
      expect((await getActiveSessionByVoice(db, GUILD_ID, voiceId, at(-HOUR / 2)))?.id).toBe(
        session.id,
      );
      expect((await getActiveSessionByVoice(db, GUILD_ID, voiceId, at(HOUR)))?.id).toBe(session.id);
      expect(await getActiveSessionByVoice(db, GUILD_ID, voiceId, session.endsAt)).toBeNull();
      expect(await getActiveSessionByVoice(db, OTHER_GUILD_ID, voiceId, at(HOUR))).toBeNull();
      expect(
        await getActiveSessionByVoice(db, GUILD_ID, '400000000000000010', at(HOUR)),
      ).toBeNull();

      await releaseSessionVoice(db, GUILD_ID, session.id, at(HOUR));
      expect(await getActiveSessionByVoice(db, GUILD_ID, voiceId, at(HOUR))).toBeNull();
    });

    it('chamada pública: uma por jogatina, desfeita se não saiu, sai do ar uma vez', async () => {
      const session = await newSession('Chamada');
      const at = new Date();
      expect(await claimSessionCall(db, OTHER_GUILD_ID, session.id, at)).toBeNull();
      expect((await claimSessionCall(db, GUILD_ID, session.id, at))?.calledAt).not.toBeNull();
      expect(await claimSessionCall(db, GUILD_ID, session.id, at)).toBeNull();

      // Não chegou ao Discord: a trava sai e dá para chamar de novo.
      expect((await releaseSessionCall(db, GUILD_ID, session.id))?.calledAt).toBeNull();
      await claimSessionCall(db, GUILD_ID, session.id, at);
      const posted = await setSessionCallMessage(db, GUILD_ID, session.id, {
        channelId: '400000000000000021',
        messageId: '400000000000000022',
      });
      expect(posted).toMatchObject({
        callChannelId: '400000000000000021',
        callMessageId: '400000000000000022',
      });
      // Com a mensagem no ar, a trava não se desfaz.
      expect(await releaseSessionCall(db, GUILD_ID, session.id)).toBeNull();
      expect(
        (await listOpenSessionCalls(db, GUILD_ID, { squadId: session.squadId })).map(
          (row) => row.id,
        ),
      ).toEqual([session.id]);

      expect(await closeSessionCall(db, GUILD_ID, session.id, '400000000000000099')).toBeNull();
      const closed = await closeSessionCall(db, GUILD_ID, session.id, '400000000000000022');
      expect(closed?.callMessageId).toBeNull();
      expect(closed?.calledAt).not.toBeNull();
      expect(await closeSessionCall(db, GUILD_ID, session.id, '400000000000000022')).toBeNull();
      expect(await listOpenSessionCalls(db, GUILD_ID, { squadId: session.squadId })).toEqual([]);
      expect(await claimSessionCall(db, GUILD_ID, session.id, at)).toBeNull();
    });

    it('jogatina começada ou cancelada não ganha chamada, e reabrir zera a chamada', async () => {
      const started = await newSession('Chamada tarde');
      await markSessionStarted(db, GUILD_ID, started.id, new Date());
      expect(await claimSessionCall(db, GUILD_ID, started.id, new Date())).toBeNull();

      const cancelled = await newSession('Chamada cancelada');
      await claimSessionCall(db, GUILD_ID, cancelled.id, new Date());
      await cancelSquadSession(db, GUILD_ID, cancelled.id, USER_A, new Date());
      const reopened = await reopenSquadSession(db, GUILD_ID, cancelled.id, {
        endsAt: cancelled.endsAt,
        createdBy: USER_A,
        goingIds: [USER_A],
      });
      expect(reopened).toMatchObject({ calledAt: null, callChannelId: null, callMessageId: null });
      expect(await claimSessionCall(db, GUILD_ID, cancelled.id, new Date())).not.toBeNull();
    });

    it('histórico: só as que rolaram desde since, com totais por squad', async () => {
      const squad = await newSquad('Histórico');
      const other = await newSquad('Histórico vazio');
      const at = (days: number) => new Date(Date.now() - days * DAY);
      const session = async (days: number, played: boolean, cancel = false) => {
        const startsAt = at(days);
        const row = await createSquadSession(db, {
          guildId: GUILD_ID,
          squadId: squad.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3 * HOUR),
          createdBy: USER_A,
          goingIds: [USER_A],
        });
        if (!row) throw new Error('jogatina não criada');
        if (played) await markSessionPlayed(db, GUILD_ID, row.id, startsAt);
        if (cancel) await cancelSquadSession(db, GUILD_ID, row.id, USER_A, startsAt);
        return row;
      };
      const recent = await session(2, true);
      const old = await session(120, true);
      await session(3, false);
      const cancelled = await session(5, false, true);

      const listed = await listPlayedSessions(db, GUILD_ID, [squad.id, other.id], at(90));
      expect(listed.map((row) => row.id)).toEqual([recent.id]);
      expect(await listPlayedSessions(db, GUILD_ID, [], at(90))).toEqual([]);
      expect(await listPlayedSessions(db, OTHER_GUILD_ID, [squad.id], at(90))).toEqual([]);
      expect(await markSessionPlayed(db, GUILD_ID, cancelled.id, new Date())).toBeNull();

      const totals = await countPlayedSessions(db, GUILD_ID, [squad.id, other.id]);
      expect(totals).toEqual([{ squadId: squad.id, played: 2, lastPlayedAt: recent.startsAt }]);
      expect(old.startsAt.getTime()).toBeLessThan(recent.startsAt.getTime());
      expect(await countPlayedSessions(db, GUILD_ID, [])).toEqual([]);

      const request = await createSquadJoinRequest(db, {
        guildId: GUILD_ID,
        squadId: squad.id,
        userId: USER_E,
        status: 'pending',
        sessionId: recent.id,
        expiresAt: new Date(Date.now() + DAY),
      });
      expect(request?.sessionId).toBe(recent.id);
    });

    it('presença: uma linha por entrada, fecha as abertas da pessoa e lista com os intervalos', async () => {
      const session = await newSession('Presença');
      const joinedAt = new Date();
      const later = new Date(joinedAt.getTime() + 1_000);
      const input = { guildId: GUILD_ID, sessionId: session.id, userId: USER_B, joinedAt };
      expect(await openSessionAttendance(db, input)).toBe(true);
      expect(await openSessionAttendance(db, input)).toBe(false);
      await openSessionAttendance(db, { ...input, joinedAt: later });
      await openSessionAttendance(db, { ...input, userId: USER_C, asGuest: true });

      const leftAt = new Date(joinedAt.getTime() + 60_000);
      expect(await closeSessionAttendance(db, OTHER_GUILD_ID, USER_B, leftAt)).toBe(0);
      expect(await closeSessionAttendance(db, GUILD_ID, USER_B, leftAt)).toBe(2);
      expect(await closeSessionAttendance(db, GUILD_ID, USER_B, leftAt)).toBe(0);

      const rows = await listSessionAttendance(db, GUILD_ID, [session.id]);
      expect(rows.sort((a, b) => (a.userId < b.userId ? -1 : 1))).toEqual([
        { sessionId: session.id, userId: USER_B, joinedAt, leftAt, asGuest: false },
        { sessionId: session.id, userId: USER_B, joinedAt: later, leftAt, asGuest: false },
        { sessionId: session.id, userId: USER_C, joinedAt, leftAt: null, asGuest: true },
      ]);
      expect(await listSessionAttendance(db, GUILD_ID, [])).toEqual([]);
      expect(await listSessionAttendance(db, OTHER_GUILD_ID, [session.id])).toEqual([]);
    });

    it('presença aberta: lista com o voice da jogatina e fecha uma linha só, uma vez', async () => {
      const session = await newSession('Presença aberta');
      const voiceChannelId = '300000000000000099';
      await reserveSessionVoice(db, GUILD_ID, session.id, {
        voiceChannelId,
        overwrites: [],
        at: new Date(),
      });
      const joinedAt = new Date();
      await openSessionAttendance(db, {
        guildId: GUILD_ID,
        sessionId: session.id,
        userId: USER_D,
        joinedAt,
      });

      const open = (await listOpenAttendance(db, GUILD_ID)).filter(
        (row) => row.sessionId === session.id,
      );
      expect(open).toEqual([{ sessionId: session.id, userId: USER_D, joinedAt, voiceChannelId }]);
      expect(
        (await listOpenAttendance(db, OTHER_GUILD_ID)).some((row) => row.sessionId === session.id),
      ).toBe(false);

      const key = { sessionId: session.id, userId: USER_D, joinedAt };
      const at = new Date(joinedAt.getTime() + 60_000);
      expect(await closeAttendanceRow(db, OTHER_GUILD_ID, key, at)).toBe(false);
      expect(await closeAttendanceRow(db, GUILD_ID, key, at)).toBe(true);
      expect(await closeAttendanceRow(db, GUILD_ID, key, at)).toBe(false);
      expect(
        (await listOpenAttendance(db, GUILD_ID)).some((row) => row.sessionId === session.id),
      ).toBe(false);
    });

    it('relatório: só o que começou, acabou, não foi relatado e não tem ninguém na sala', async () => {
      const session = await newSession('Relatório');
      const now = new Date(session.endsAt.getTime() + HOUR);
      const window = { now, since: new Date(session.startsAt.getTime() - DAY) };
      const listed = async () =>
        (await listSessionsToReport(db, GUILD_ID, window)).map((row) => row.id);

      // Marcada e não começada: nada a relatar.
      expect(await listed()).not.toContain(session.id);
      await markSessionStarted(db, GUILD_ID, session.id, session.startsAt);
      // Ainda rolando (o fim é depois de agora).
      expect(
        (
          await listSessionsToReport(db, GUILD_ID, { now: session.startsAt, since: window.since })
        ).map((row) => row.id),
      ).not.toContain(session.id);
      expect(await listed()).toContain(session.id);

      // Alguém ainda no voice segura o relatório até a presença fechar.
      const joinedAt = session.startsAt;
      const key = { sessionId: session.id, userId: USER_B, joinedAt };
      await openSessionAttendance(db, { guildId: GUILD_ID, ...key });
      expect(await listed()).not.toContain(session.id);
      await closeAttendanceRow(db, GUILD_ID, key, now);
      expect(await listed()).toContain(session.id);

      // Velha demais para a janela, e de outra guild: fora dos dois jeitos.
      expect(
        (
          await listSessionsToReport(db, GUILD_ID, { now, since: new Date(now.getTime() + DAY) })
        ).map((row) => row.id),
      ).not.toContain(session.id);
      expect(await listSessionsToReport(db, OTHER_GUILD_ID, window)).toEqual([]);

      expect(await markSessionReported(db, OTHER_GUILD_ID, session.id, now)).toBeNull();
      expect((await markSessionReported(db, GUILD_ID, session.id, now))?.reportedAt).toEqual(now);
      expect(await markSessionReported(db, GUILD_ID, session.id, now)).toBeNull();
      expect(await listed()).not.toContain(session.id);
    });

    it('relatório: a sala devolvida depois do início encerra antes do fim previsto', async () => {
      const session = await newSession('Relatório cedo');
      const startedAt = new Date(session.startsAt.getTime());
      await markSessionStarted(db, GUILD_ID, session.id, startedAt);
      const window = {
        now: new Date(startedAt.getTime() + HOUR),
        since: new Date(session.startsAt.getTime() - DAY),
      };
      const listed = async () =>
        (await listSessionsToReport(db, GUILD_ID, window)).map((row) => row.id);
      expect(await listed()).not.toContain(session.id);

      await reserveSessionVoice(db, GUILD_ID, session.id, {
        voiceChannelId: '300000000000000098',
        overwrites: [],
        at: startedAt,
      });
      await releaseSessionVoice(db, GUILD_ID, session.id, window.now);
      expect(await listed()).toContain(session.id);
    });

    it('convidado: um por pessoa, respeita o teto e só entra em jogatina viva', async () => {
      const session = await newSession('Convidados');
      const now = new Date();
      const input = {
        guildId: GUILD_ID,
        sessionId: session.id,
        invitedBy: USER_A,
        max: 2,
        now,
      };
      const added = await addSessionGuest(db, { ...input, userId: USER_B });
      expect(added).toMatchObject({
        outcome: 'added',
        guest: { sessionId: session.id, userId: USER_B, invitedBy: USER_A, threadId: null },
      });
      expect(await addSessionGuest(db, { ...input, userId: USER_B })).toEqual({
        outcome: 'exists',
      });
      expect(await addSessionGuest(db, { ...input, userId: USER_C })).toMatchObject({
        outcome: 'added',
      });
      expect(await addSessionGuest(db, { ...input, userId: USER_D })).toEqual({ outcome: 'full' });
      // O teto vale sob a trava: dois pedidos juntos não passam os dois.
      const other = await newSession('Convidados juntos');
      const race = await Promise.all(
        [USER_B, USER_C, USER_D].map((userId) =>
          addSessionGuest(db, { ...input, sessionId: other.id, userId, max: 1 }),
        ),
      );
      expect(race.filter((result) => result.outcome === 'added')).toHaveLength(1);

      expect(await setSessionGuestThread(db, GUILD_ID, session.id, USER_B, '5100')).toMatchObject({
        threadId: '5100',
      });
      expect(
        await setSessionGuestThread(db, OTHER_GUILD_ID, session.id, USER_B, '5101'),
      ).toBeNull();
      expect(
        (await listSessionGuests(db, GUILD_ID, [session.id])).map((guest) => guest.userId),
      ).toEqual([USER_B, USER_C]);
      expect(await listSessionGuests(db, GUILD_ID, [])).toEqual([]);
      expect(await listSessionGuests(db, OTHER_GUILD_ID, [session.id])).toEqual([]);

      expect(await removeSessionGuest(db, OTHER_GUILD_ID, session.id, USER_C)).toBe(false);
      expect(await removeSessionGuest(db, GUILD_ID, session.id, USER_C)).toBe(true);
      expect(await removeSessionGuest(db, GUILD_ID, session.id, USER_C)).toBe(false);

      const cancelled = await newSession('Convidado cancelada');
      await cancelSquadSession(db, GUILD_ID, cancelled.id, USER_A, now);
      expect(
        await addSessionGuest(db, { ...input, sessionId: cancelled.id, userId: USER_B }),
      ).toEqual({ outcome: 'closed' });
      const ended = { ...input, sessionId: session.id, userId: USER_E };
      expect(await addSessionGuest(db, { ...ended, now: session.endsAt })).toEqual({
        outcome: 'closed',
      });
      expect(
        await addSessionGuest(db, { ...input, guildId: OTHER_GUILD_ID, userId: USER_E }),
      ).toEqual({ outcome: 'closed' });

      // Começou e o voice esvaziou: a reserva liberada depois do início encerra.
      const emptied = await newSession('Convidado esvaziou');
      await reserveSessionVoice(db, GUILD_ID, emptied.id, {
        voiceChannelId: '300000000000000098',
        overwrites: [],
        at: now,
      });
      await markSessionStarted(db, GUILD_ID, emptied.id, now);
      const live = { ...input, sessionId: emptied.id, userId: USER_B };
      expect(await addSessionGuest(db, live)).toMatchObject({ outcome: 'added' });
      await releaseSessionVoice(db, GUILD_ID, emptied.id, new Date(now.getTime() + 1_000));
      expect(await addSessionGuest(db, { ...live, userId: USER_C })).toEqual({ outcome: 'closed' });
    });
  });

  describe('squads e membros', () => {
    it('o guia só é gravado sobre o valor esperado', async () => {
      const squad = await newSquad('Guia');
      expect(
        (await setSquadGuideMessage(db, GUILD_ID, squad.id, '300000000000000010', null))
          ?.guideMessageId,
      ).toBe('300000000000000010');
      expect(
        await setSquadGuideMessage(db, GUILD_ID, squad.id, '300000000000000011', null),
      ).toBeNull();
      expect(
        (
          await setSquadGuideMessage(
            db,
            GUILD_ID,
            squad.id,
            '300000000000000011',
            '300000000000000010',
          )
        )?.guideMessageId,
      ).toBe('300000000000000011');
      expect(
        await setSquadGuideMessage(db, OTHER_GUILD_ID, squad.id, null, '300000000000000011'),
      ).toBeNull();
    });

    it('syncSquadStatusesToGroupSize reabre ou fecha a vaga pelo tamanho novo, só no jogo', async () => {
      const sized = await createSquadGame(db, {
        guildId: GUILD_ID,
        name: 'Tamanho do grupo',
        groupSize: 2,
        partySize: 2,
      });
      if (!sized) throw new Error('jogo de tamanho não foi criado');
      const squadOf = async (name: string, userIds: string[], status: 'open' | 'full') => {
        const squad = await createSquad(db, { guildId: GUILD_ID, gameId: sized.id, name });
        for (const userId of userIds) {
          await addSquadMember(db, { guildId: GUILD_ID, squadId: squad.id, userId });
        }
        return (await setSquadStatus(db, GUILD_ID, squad.id, status))!;
      };
      const pair = await squadOf('Dupla cheia', [USER_A, USER_B], 'full');
      const trio = await squadOf('Trio aberto', [USER_A, USER_B, USER_C], 'open');
      const solo = await squadOf('Solo', [USER_D], 'open');
      const archived = await squadOf('Arquivado cheio', [USER_A, USER_B], 'full');
      await archiveSquad(db, GUILD_ID, archived.id, new Date());
      const otherGame = await newSquad('Outro jogo cheio');
      for (const userId of [USER_A, USER_B]) {
        await addSquadMember(db, { guildId: GUILD_ID, squadId: otherGame.id, userId });
      }
      await setSquadStatus(db, GUILD_ID, otherGame.id, 'full');

      const grown = await syncSquadStatusesToGroupSize(db, GUILD_ID, sized.id, 3);
      expect(grown.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
        [
          { id: pair.id, status: 'open' },
          { id: trio.id, status: 'full' },
        ].sort((a, b) => a.id.localeCompare(b.id)),
      );
      expect(await syncSquadStatusesToGroupSize(db, GUILD_ID, sized.id, 3)).toEqual([]);
      expect((await getSquad(db, GUILD_ID, solo.id))?.status).toBe('open');
      expect((await getSquad(db, GUILD_ID, archived.id))?.status).toBe('archived');
      expect((await getSquad(db, GUILD_ID, otherGame.id))?.status).toBe('full');
      expect(await syncSquadStatusesToGroupSize(db, OTHER_GUILD_ID, sized.id, 10)).toEqual([]);
    });

    it('countSquadsForUser ignora arquivados', async () => {
      const active = await newSquad('Ativo');
      const archived = await newSquad('Arquivado');
      for (const squad of [active, archived]) {
        expect(
          await addSquadMember(db, { guildId: GUILD_ID, squadId: squad.id, userId: USER_E }),
        ).not.toBeNull();
      }
      expect(
        await addSquadMember(db, { guildId: GUILD_ID, squadId: active.id, userId: USER_E }),
      ).toBeNull();
      expect(await countSquadsForUser(db, GUILD_ID, USER_E)).toBe(2);

      expect((await archiveSquad(db, GUILD_ID, archived.id, new Date()))?.status).toBe('archived');
      expect(await archiveSquad(db, GUILD_ID, archived.id, new Date())).toBeNull();
      expect(await setSquadStatus(db, GUILD_ID, archived.id, 'open')).toBeNull();

      expect(await countSquadsForUser(db, GUILD_ID, USER_E)).toBe(1);
      expect((await listSquadsForUser(db, GUILD_ID, USER_E)).map((s) => s.id)).toEqual([active.id]);
      expect(
        (await listSquadsForUser(db, GUILD_ID, USER_E, { includeArchived: true })).map((s) => s.id),
      ).toEqual([active.id, archived.id]);
    });

    it('listInactiveSquads usa created_at sem confirmação e ignora arquivados', async () => {
      const longAgo = new Date(Date.now() - 60 * DAY);
      const age = async (name: string) => {
        const squad = await newSquad(name);
        await db.update(squads).set({ createdAt: longAgo }).where(eq(squads.id, squad.id));
        return squad;
      };

      const neverConfirmed = await age('Nunca confirmou');
      const confirmedRecently = await age('Confirmou agora');
      await touchSquadConfirmed(db, GUILD_ID, confirmedRecently.id, new Date(Date.now() - DAY));
      const confirmedLongAgo = await age('Confirmou faz tempo');
      await touchSquadConfirmed(db, GUILD_ID, confirmedLongAgo.id, new Date(Date.now() - 40 * DAY));
      const archived = await age('Arquivado e velho');
      await archiveSquad(db, GUILD_ID, archived.id, new Date());
      const young = await newSquad('Recém-criado');

      const since = new Date(Date.now() - 28 * DAY);
      const ids = (await listInactiveSquads(db, GUILD_ID, since)).map((squad) => squad.id);
      expect(ids).toContain(neverConfirmed.id);
      expect(ids).toContain(confirmedLongAgo.id);
      expect(ids).not.toContain(confirmedRecently.id);
      expect(ids).not.toContain(archived.id);
      expect(ids).not.toContain(young.id);
    });

    it('listMembersOfSquads traz só os squads pedidos, só da guild', async () => {
      const first = await newSquad('Lista um');
      const second = await newSquad('Lista dois');
      const skipped = await newSquad('Fora da lista');
      await addSquadMember(db, { guildId: GUILD_ID, squadId: first.id, userId: USER_A });
      await addSquadMember(db, { guildId: GUILD_ID, squadId: second.id, userId: USER_B });
      await addSquadMember(db, { guildId: GUILD_ID, squadId: first.id, userId: USER_C });
      await addSquadMember(db, { guildId: GUILD_ID, squadId: skipped.id, userId: USER_D });

      const pairs = (await listMembersOfSquads(db, GUILD_ID, [first.id, second.id]))
        .map((member) => `${member.squadId}:${member.userId}`)
        .sort();
      expect(pairs).toEqual(
        [`${first.id}:${USER_A}`, `${first.id}:${USER_C}`, `${second.id}:${USER_B}`].sort(),
      );
      expect(await listMembersOfSquads(db, OTHER_GUILD_ID, [first.id])).toEqual([]);
      expect(await listMembersOfSquads(db, GUILD_ID, [])).toEqual([]);
    });

    it('countSearchingProfilesByGame conta só searching, por jogo e por guild', async () => {
      const other = await createSquadGame(db, {
        guildId: GUILD_ID,
        name: 'Contagem',
        groupSize: 2,
        partySize: 2,
      });
      if (!other) throw new Error('jogo de contagem não foi criado');
      const profiles = [
        [USER_A, 'searching'],
        [USER_B, 'searching'],
        [USER_C, 'paused'],
      ] as const;
      for (const [userId, status] of profiles) {
        await upsertSquadProfile(db, {
          guildId: GUILD_ID,
          userId,
          gameId: other.id,
          availability: 1,
          answers: {},
          status,
        });
      }

      expect((await countSearchingProfilesByGame(db, GUILD_ID))[other.id]).toBe(2);
      // A outra guild tem perfis de outros blocos; o que importa é não ver este jogo.
      expect(await countSearchingProfilesByGame(db, OTHER_GUILD_ID)).not.toHaveProperty(other.id);
    });
  });
});
