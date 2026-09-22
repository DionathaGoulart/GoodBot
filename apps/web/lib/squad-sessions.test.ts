import { describe, expect, it } from 'vitest';

import {
  buildPlayerSessionStats,
  buildSessionsView,
  matrixKey,
  type SessionsFilter,
  type SquadSessionsData,
} from './squad-sessions';

const MINUTE = 60_000;
const NOW = Date.parse('2026-09-22T12:00:00.000Z');

const G1 = 'game-1';
const G2 = 'game-2';
const ALFA = 'squad-alfa';
const BETA = 'squad-beta';
const GAMA = 'squad-gama';

const A = '300000000000000001';
const B = '300000000000000002';
const C = '300000000000000003';
const D = '300000000000000004';

/**
 * Uma jogatina medida (a 1), uma marcada que passou em branco (a 2), uma
 * ainda por vir (a 3), uma velha fora dos 30 dias (a 4) e uma cancelada de
 * outro jogo (a 5). As linhas chegam do banco da mais recente, como a leitura.
 *
 * Na jogatina 1: A das 23h à 1h, B das 23h à meia-noite, D (convidado) das
 * 23h30 à meia-noite, e C disse VOU e não apareceu.
 */
const DATA: SquadSessionsData = {
  sessions: [
    {
      id: 3,
      squadId: ALFA,
      startsAt: '2026-09-25T23:00:00.000Z',
      endsAt: '2026-09-26T05:00:00.000Z',
      goingIds: [A, B],
      startedAt: null,
      playedAt: null,
      cancelledAt: null,
    },
    {
      id: 5,
      squadId: GAMA,
      startsAt: '2026-09-21T23:00:00.000Z',
      endsAt: '2026-09-22T05:00:00.000Z',
      goingIds: [A],
      startedAt: null,
      playedAt: null,
      cancelledAt: '2026-09-21T20:00:00.000Z',
    },
    {
      id: 1,
      squadId: ALFA,
      startsAt: '2026-09-20T23:00:00.000Z',
      endsAt: '2026-09-21T05:00:00.000Z',
      goingIds: [A, B, C],
      startedAt: '2026-09-20T23:00:00.000Z',
      playedAt: '2026-09-20T23:00:00.000Z',
      cancelledAt: null,
    },
    {
      id: 2,
      squadId: BETA,
      startsAt: '2026-09-19T23:00:00.000Z',
      endsAt: '2026-09-20T05:00:00.000Z',
      goingIds: [A],
      startedAt: '2026-09-19T23:00:00.000Z',
      playedAt: null,
      cancelledAt: null,
    },
    {
      id: 4,
      squadId: ALFA,
      startsAt: '2026-07-10T23:00:00.000Z',
      endsAt: '2026-07-11T05:00:00.000Z',
      goingIds: [A],
      startedAt: '2026-07-10T23:00:00.000Z',
      playedAt: '2026-07-10T23:00:00.000Z',
      cancelledAt: null,
    },
  ],
  attendance: [
    {
      sessionId: 1,
      userId: A,
      joinedAt: '2026-09-20T23:00:00.000Z',
      leftAt: '2026-09-21T01:00:00.000Z',
      asGuest: false,
    },
    {
      sessionId: 1,
      userId: B,
      joinedAt: '2026-09-20T23:00:00.000Z',
      leftAt: '2026-09-21T00:00:00.000Z',
      asGuest: false,
    },
    {
      sessionId: 1,
      userId: D,
      joinedAt: '2026-09-20T23:30:00.000Z',
      leftAt: '2026-09-21T00:00:00.000Z',
      asGuest: true,
    },
    {
      sessionId: 4,
      userId: A,
      joinedAt: '2026-07-10T23:00:00.000Z',
      leftAt: '2026-07-11T00:00:00.000Z',
      asGuest: false,
    },
  ],
  squads: [
    { id: ALFA, gameId: G1, name: 'Alfa' },
    { id: BETA, gameId: G1, name: 'Beta' },
    { id: GAMA, gameId: G2, name: 'Gama' },
  ],
  members: {
    [A]: { displayName: 'Ana', username: 'ana', avatarUrl: null },
    [B]: { displayName: 'Bia', username: 'bia', avatarUrl: null },
    [C]: { displayName: 'Caio', username: 'caio', avatarUrl: null },
    [D]: { displayName: 'Davi', username: 'davi', avatarUrl: null },
  },
  membersError: null,
  loadedAt: NOW,
  windowDays: 90,
};

const view = (filter: Partial<SessionsFilter> = {}, partySize = 4) =>
  buildSessionsView(DATA, { gameId: null, squadId: null, days: 30, ...filter }, partySize);

const rowOf = (id: number) => {
  const row = view().rows.find((entry) => entry.id === id);
  if (!row) throw new Error(`jogatina ${String(id)} fora do filtro`);
  return row;
};

describe('buildSessionsView', () => {
  it('conta o que foi marcado, o que rolou e o que foi cancelado', () => {
    expect(view().summary).toMatchObject({ scheduled: 4, played: 1, cancelled: 1 });
  });

  it('deixa de fora a jogatina mais velha que a janela', () => {
    expect(view().rows.map((row) => row.id)).toEqual([3, 5, 1, 2]);
    expect(view({ days: 90 }).rows.map((row) => row.id)).toEqual([3, 5, 1, 2, 4]);
    expect(view({ days: 90 }).summary.played).toBe(2);
  });

  it('filtra por jogo e por squad', () => {
    expect(view({ gameId: G2 }).rows.map((row) => row.id)).toEqual([5]);
    expect(view({ squadId: BETA }).rows.map((row) => row.id)).toEqual([2]);
  });

  it('dá a cada jogatina o estado que a tela mostra', () => {
    expect(rowOf(3).status).toBe('scheduled');
    expect(rowOf(5).status).toBe('cancelled');
    expect(rowOf(1).status).toBe('played');
    expect(rowOf(2).status).toBe('no_show');
  });

  it('não inventa relatório para a que ainda não aconteceu', () => {
    expect(rowOf(3).report).toBeNull();
    expect(rowOf(5).report).toBeNull();
    expect(rowOf(2).report?.outcome).toBe('not_played');
  });

  it('resume a jogatina medida com quem foi, quem faltou e o convidado', () => {
    expect(rowOf(1)).toMatchObject({
      durationMs: 120 * MINUTE,
      goingCount: 3,
      playedCount: 2,
      guestCount: 1,
      noShowCount: 1,
    });
  });

  it('conta o tempo de sala uma vez, e não uma por pessoa', () => {
    // 30 min de dupla + 30 min de trio + 60 min de solo; a soma por pessoa
    // daria 3 h 30.
    expect(view().summary.roomMs).toBe(120 * MINUTE);
  });

  it('mede a presença pelos VOU cumpridos, sem contar o convidado', () => {
    expect(view().summary.attendanceRate).toBeCloseTo(2 / 3);
  });

  it('ordena o ranking pelo tempo e marca quem só entrou como convidado', () => {
    const players = view().players;
    expect(players.map((player) => player.name)).toEqual(['Ana', 'Bia', 'Davi', 'Caio']);
    expect(players[0]).toMatchObject({ ms: 120 * MINUTE, kept: 1, noShows: 0 });
    expect(players[2]).toMatchObject({ ms: 30 * MINUTE, going: 0, guestOnly: true });
    expect(players[3]).toMatchObject({ ms: 0, noShows: 1, sessions: 0 });
  });

  it('separa o tempo por tamanho de grupo', () => {
    expect(
      view().formations.bySize.map((size) => [size.label, size.ms / MINUTE, size.party]),
    ).toEqual([
      ['solo', 60, 'partial'],
      ['dupla', 30, 'partial'],
      ['trio', 30, 'partial'],
    ]);
  });

  it('marca a party cheia pelo tamanho do jogo', () => {
    const trio = view({}, 3).formations.bySize.find((size) => size.size === 3);
    expect(trio?.party).toBe('full');
  });

  it('conta a dupla com ou sem mais gente na sala', () => {
    const pairs = view().pairs;
    expect(pairs.map((pair) => [pair.names.join(' e '), pair.ms / MINUTE])).toEqual([
      ['Ana e Bia', 60],
      ['Ana e Davi', 30],
      ['Bia e Davi', 30],
    ]);
    expect(view().pairMs.get(matrixKey(A, B))).toBe(60 * MINUTE);
  });

  it('conta o grupo exato só quando eram exatamente aquelas pessoas', () => {
    expect(view().groups.map((group) => [group.names.join(', '), group.ms / MINUTE])).toEqual([
      ['Ana, Bia', 30],
      ['Ana, Bia, Davi', 30],
    ]);
  });

  it('corta as duplas da pessoa depois de filtrar, e não antes', () => {
    const focused = view({ focusUserId: D });
    expect(focused.pairs.map((pair) => pair.names.join(' e '))).toEqual([
      'Ana e Davi',
      'Bia e Davi',
    ]);
    expect(view({ focusUserId: C }).pairs).toEqual([]);
  });

  it('cai para o id quando o bot não deu o nome', () => {
    const anonymous = { ...DATA, members: {} };
    expect(buildSessionsView(anonymous, { gameId: null, squadId: null, days: 30 }, 4).players[0])
      .toMatchObject({ name: A });
  });
});

describe('jogatina ainda rolando', () => {
  const running: SquadSessionsData = {
    ...DATA,
    sessions: [
      {
        id: 6,
        squadId: ALFA,
        startsAt: '2026-09-22T11:00:00.000Z',
        endsAt: '2026-09-22T17:00:00.000Z',
        goingIds: [A],
        startedAt: '2026-09-22T11:00:00.000Z',
        playedAt: '2026-09-22T11:00:00.000Z',
        cancelledAt: null,
      },
    ],
    attendance: [
      {
        sessionId: 6,
        userId: A,
        joinedAt: '2026-09-22T11:00:00.000Z',
        leftAt: null,
        asGuest: false,
      },
    ],
  };

  it('conta a presença aberta até agora e avisa que o número é provisório', () => {
    const row = buildSessionsView(running, { gameId: null, squadId: null, days: 30 }, 4).rows[0];
    expect(row).toMatchObject({ status: 'running', durationMs: 60 * MINUTE });
    expect(row?.report?.open).toBe(true);
  });
});

describe('buildPlayerSessionStats', () => {
  it('soma os squads do jogo e devolve só as duplas da pessoa', () => {
    const stats = buildPlayerSessionStats(DATA, G1, A, 4);
    expect(stats.stats).toMatchObject({ ms: 180 * MINUTE, kept: 2, noShows: 0 });
    expect(stats.pairs.map((pair) => pair.names.join(' e '))).toEqual(['Ana e Bia', 'Ana e Davi']);
    expect(stats.sessions).toBe(2);
  });

  it('devolve nulo para quem nunca jogou', () => {
    expect(buildPlayerSessionStats(DATA, G2, A, 4).stats).toBeNull();
  });
});
