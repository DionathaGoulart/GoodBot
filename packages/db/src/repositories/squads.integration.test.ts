import { joinRequestKey, pairKey } from '@goodbot/shared';
import { eq, inArray, TransactionRollbackError } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Db } from '../client';
import { loadRootEnv } from '../env';
import {
  acceptSquadProposal,
  addSquadMember,
  archiveSquad,
  cancelSquadSession,
  claimProposalSquad,
  closeSquadProposal,
  countSearchingProfilesByGame,
  countSquadsForUser,
  createSquad,
  createSquadGame,
  createSquadJoinRequest,
  createSquadProposal,
  createSquadSession,
  declineSquadJoinRequestBy,
  declineSquadProposal,
  decideSquadJoinRequest,
  deleteSquadProfile,
  getActiveSessionByVoice,
  getSquad,
  getSquadJoinRequest,
  getSquadProposal,
  getSquadSessionAt,
  listInactiveSquads,
  listMembersOfSquads,
  listPendingJoinRequests,
  listRecentJoinRequestKeys,
  listRecentProposalPairs,
  listSessionsToRelease,
  listSquadProfilesByGame,
  listSquads,
  listSquadsForUser,
  listUpcomingSessions,
  markSessionPlayed,
  markSessionReminded,
  markSessionStarted,
  releaseSessionVoice,
  reopenSquadSession,
  reserveSessionVoice,
  setSessionMessage,
  setSquadGuideMessage,
  setSquadStatus,
  syncSquadStatusesToGroupSize,
  touchSquadConfirmed,
  upsertSquadProfile,
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

  const newSquad = (name: string) =>
    createSquad(db, { guildId: GUILD_ID, gameId: game.id, name });

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
    it('um pendente por pessoa e squad; depois de decidido, pode pedir de novo', async () => {
      const squad = await newSquad('Pedidos');
      const input = { guildId: GUILD_ID, squadId: squad.id, userId: USER_B };

      const first = await createSquadJoinRequest(db, input);
      expect(first?.status).toBe('pending');
      expect(await createSquadJoinRequest(db, input)).toBeNull();

      const decided = await decideSquadJoinRequest(db, GUILD_ID, first!.id, {
        status: 'declined',
        decidedBy: USER_A,
        at: new Date(),
      });
      expect(decided?.status).toBe('declined');
      // Outro membro clica "Aceitar" logo depois: o pedido já foi decidido.
      expect(
        await decideSquadJoinRequest(db, GUILD_ID, first!.id, {
          status: 'accepted',
          decidedBy: USER_C,
          at: new Date(),
        }),
      ).toBeNull();

      const again = await createSquadJoinRequest(db, input);
      expect(again).not.toBeNull();
      expect(again?.id).not.toBe(first?.id);
      expect((await listPendingJoinRequests(db, GUILD_ID, squad.id)).map((r) => r.id)).toEqual([
        again?.id,
      ]);
    });

    it('declineSquadJoinRequestBy não repete o voto e para depois da decisão', async () => {
      const squad = await newSquad('Recusas');
      const request = await createSquadJoinRequest(db, {
        guildId: GUILD_ID,
        squadId: squad.id,
        userId: USER_D,
      });
      const id = request!.id;

      expect((await declineSquadJoinRequestBy(db, GUILD_ID, id, USER_A))?.declinedIds).toEqual([
        USER_A,
      ]);
      expect(await declineSquadJoinRequestBy(db, GUILD_ID, id, USER_A)).toBeNull();
      expect((await declineSquadJoinRequestBy(db, GUILD_ID, id, USER_B))?.declinedIds).toEqual([
        USER_A,
        USER_B,
      ]);

      await decideSquadJoinRequest(db, GUILD_ID, id, {
        status: 'accepted',
        decidedBy: USER_C,
        at: new Date(),
      });
      expect(await declineSquadJoinRequestBy(db, GUILD_ID, id, USER_C)).toBeNull();
      expect((await getSquadJoinRequest(db, GUILD_ID, id))?.declinedIds).toEqual([USER_A, USER_B]);
    });

    it('listRecentJoinRequestKeys: qualquer status desde since, sem repetir, só da guild', async () => {
      const squad = await newSquad('Chaves');
      const first = await createSquadJoinRequest(db, {
        guildId: GUILD_ID,
        squadId: squad.id,
        userId: USER_C,
      });
      await decideSquadJoinRequest(db, GUILD_ID, first!.id, {
        status: 'declined',
        decidedBy: USER_A,
        at: new Date(),
      });
      await createSquadJoinRequest(db, { guildId: GUILD_ID, squadId: squad.id, userId: USER_C });
      const old = await createSquadJoinRequest(db, {
        guildId: GUILD_ID,
        squadId: squad.id,
        userId: USER_E,
      });
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
      expect(
        (await getSquadSessionAt(db, GUILD_ID, session.squadId, session.startsAt))?.id,
      ).toBe(session.id);
      expect(await getSquadSessionAt(db, OTHER_GUILD_ID, session.squadId, session.startsAt)).toBeNull();

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
      expect((await listUpcomingSessions(db, GUILD_ID, now, { squadIds: [session.squadId] })).map((row) => row.id)).toEqual([session.id]);

      const cancelled = await cancelSquadSession(db, GUILD_ID, session.id, USER_A, now);
      expect(cancelled?.cancelledBy).toBe(USER_A);
      expect(await cancelSquadSession(db, GUILD_ID, session.id, USER_A, now)).toBeNull();
      expect(await voteSquadSession(db, GUILD_ID, session.id, USER_B, true)).toBeNull();
      expect(await markSessionPlayed(db, GUILD_ID, session.id, now)).toBeNull();
      expect(await listUpcomingSessions(db, GUILD_ID, now, { squadIds: [session.squadId] })).toEqual([]);
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
      expect((await reopenSquadSession(db, GUILD_ID, session.id, input))?.voiceReservedAt).toBeNull();
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
  });

  describe('squads e membros', () => {
    it('o guia só é gravado sobre o valor esperado', async () => {
      const squad = await newSquad('Guia');
      expect((await setSquadGuideMessage(db, GUILD_ID, squad.id, '300000000000000010', null))?.guideMessageId).toBe('300000000000000010');
      expect(await setSquadGuideMessage(db, GUILD_ID, squad.id, '300000000000000011', null)).toBeNull();
      expect(
        (await setSquadGuideMessage(db, GUILD_ID, squad.id, '300000000000000011', '300000000000000010'))
          ?.guideMessageId,
      ).toBe('300000000000000011');
      expect(await setSquadGuideMessage(db, OTHER_GUILD_ID, squad.id, null, '300000000000000011')).toBeNull();
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
