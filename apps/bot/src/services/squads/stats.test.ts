import { HOUR_MS } from '@goodbot/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { A, B, C, createHarness, D } from './__fixtures__/harness';

const fixtures = await vi.hoisted(async () => import('./__fixtures__/fake-db'));
vi.mock('@goodbot/db', () => fixtures.repositories);

const { store, seedGame, seedMember, seedSession, seedSquad } = fixtures;

/** Uma pessoa no voice da jogatina, do minuto `from` ao `to` (em horas do início). */
function present(
  sessionId: number,
  userId: string,
  startsAt: Date,
  from: number,
  to: number,
  asGuest = false,
): void {
  store.attendance.push({
    guildId: store.squads[0]!.guildId,
    sessionId,
    userId,
    joinedAt: new Date(startsAt.getTime() + from * HOUR_MS),
    leftAt: new Date(startsAt.getTime() + to * HOUR_MS),
    asGuest,
  });
}

/**
 * Duas jogatinas que rolaram: a de anteontem (A duas horas, B a primeira
 * delas) e a de 40 dias atrás (A, B, C e o convidado D por uma hora, a party
 * cheia). C disse VOU na primeira e não apareceu.
 */
function scenario() {
  const harness = createHarness();
  const game = seedGame({ groupSize: 4, partySize: 4 });
  const squad = seedSquad({ gameId: game.id, name: 'Os Bravos' });
  for (const userId of [A, B, C]) seedMember(squad.id, userId);

  const recentAt = new Date('2026-09-12T00:00:00Z');
  const recent = seedSession({
    squadId: squad.id,
    startsAt: recentAt,
    endsAt: new Date(recentAt.getTime() + 3 * HOUR_MS),
    goingIds: [A, B, C],
    playedAt: recentAt,
  });
  present(recent.id, A, recentAt, 0, 2);
  present(recent.id, B, recentAt, 0, 1);

  const oldAt = new Date('2026-08-05T00:00:00Z');
  const old = seedSession({
    squadId: squad.id,
    startsAt: oldAt,
    endsAt: new Date(oldAt.getTime() + 3 * HOUR_MS),
    goingIds: [A, B, C],
    playedAt: oldAt,
  });
  for (const userId of [A, B, C]) present(old.id, userId, oldAt, 0, 1);
  present(old.id, D, oldAt, 0, 1, true);

  return { ...harness, game, squad, recent, old, recentAt, oldAt };
}

describe('StatsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('forPlayer', () => {
    it('soma tempo, formações, presença e com quem mais joga', async () => {
      const s = scenario();

      const stats = await s.service.playerStats(s.squad.guildId, s.game.id, A);

      expect(stats.ms).toBe(3 * HOUR_MS);
      expect(stats.msRecent).toBe(2 * HOUR_MS);
      expect(stats.sessions).toBe(2);
      expect(stats.played).toBe(2);
      expect(stats.going).toBe(2);
      expect(stats.noShows).toBe(0);
      expect(stats.attendanceRate).toBe(1);
      // Uma hora de dupla e uma solo na jogatina nova, uma de party cheia na velha.
      expect(stats.bySize).toEqual([
        { size: 1, label: 'solo', party: 'partial', ms: HOUR_MS },
        { size: 2, label: 'dupla', party: 'partial', ms: HOUR_MS },
        { size: 4, label: 'quarteto', party: 'full', ms: HOUR_MS },
      ]);
      // B esteve com A nas duas; C e D só na velha, e o empate sai pelo id.
      expect(stats.pairs).toEqual([
        { userIds: [A, B], ms: 2 * HOUR_MS },
        { userIds: [A, C], ms: HOUR_MS },
        { userIds: [A, D], ms: HOUR_MS },
      ]);
      expect(stats.groups).toEqual([
        { userIds: [A, B], ms: HOUR_MS },
        { userIds: [A, B, C, D], ms: HOUR_MS },
      ]);
    });

    it('VOU sem aparecer vira falta e derruba a presença', async () => {
      const s = scenario();

      const stats = await s.service.playerStats(s.squad.guildId, s.game.id, C);

      expect(stats.ms).toBe(HOUR_MS);
      expect(stats.msRecent).toBe(0);
      expect(stats.sessions).toBe(1);
      expect(stats.going).toBe(2);
      expect(stats.noShows).toBe(1);
      expect(stats.attendanceRate).toBe(0.5);
    });

    it('quem nunca apareceu vem zerado, e não como erro', async () => {
      const s = scenario();

      const stats = await s.service.playerStats(s.squad.guildId, s.game.id, '999999999999999999');

      expect(stats).toMatchObject({ ms: 0, sessions: 0, played: 2, attendanceRate: null });
      expect(stats.pairs).toEqual([]);
      expect(stats.groups).toEqual([]);
    });

    it('conta os squads do jogo, e só eles', async () => {
      const s = scenario();
      // Outro squad do mesmo jogo: o tempo de A lá soma no total dele.
      const other = seedSquad({ gameId: s.game.id, name: 'Os Outros' });
      const at = new Date('2026-09-13T00:00:00Z');
      const session = seedSession({
        squadId: other.id,
        startsAt: at,
        endsAt: new Date(at.getTime() + 3 * HOUR_MS),
        goingIds: [A],
        playedAt: at,
      });
      present(session.id, A, at, 0, 1);
      // Squad de outro jogo: fica de fora.
      const elsewhere = seedSquad({ gameId: seedGame({ name: 'Deep Rock' }).id });
      const away = seedSession({
        squadId: elsewhere.id,
        startsAt: at,
        endsAt: new Date(at.getTime() + 3 * HOUR_MS),
        goingIds: [A],
        playedAt: at,
      });
      present(away.id, A, at, 0, 5);

      const stats = await s.service.playerStats(s.squad.guildId, s.game.id, A);

      expect(stats.ms).toBe(4 * HOUR_MS);
      expect(stats.played).toBe(3);
    });

    it('fora da janela de 90 dias não conta', async () => {
      const s = scenario();
      const at = new Date('2026-05-01T00:00:00Z');
      const old = seedSession({
        squadId: s.squad.id,
        startsAt: at,
        endsAt: new Date(at.getTime() + 3 * HOUR_MS),
        goingIds: [A],
        playedAt: at,
      });
      present(old.id, A, at, 0, 5);

      const stats = await s.service.playerStats(s.squad.guildId, s.game.id, A);

      expect(stats.ms).toBe(3 * HOUR_MS);
      expect(stats.played).toBe(2);
    });

    it('jogatina que não rolou fica de fora da conta', async () => {
      const s = scenario();
      const at = new Date('2026-09-13T00:00:00Z');
      seedSession({
        squadId: s.squad.id,
        startsAt: at,
        endsAt: new Date(at.getTime() + 3 * HOUR_MS),
        goingIds: [A, B, C],
      });

      const stats = await s.service.playerStats(s.squad.guildId, s.game.id, A);

      expect(stats.played).toBe(2);
      expect(stats.going).toBe(2);
    });

    it('jogo que não existe ensina a escolher um da lista', async () => {
      const s = scenario();

      await expect(
        s.service.playerStats(s.squad.guildId, '00000000-0000-4000-8000-000000000000', A),
      ).rejects.toMatchObject({ code: 'GAME_NOT_FOUND' });
    });
  });

  describe('forSquad', () => {
    it('ranking, formações, duplas e grupos do squad', async () => {
      const s = scenario();

      const stats = await s.service.squadStats(s.squad.guildId, s.squad.id);

      expect(stats.played).toBe(2);
      // Tempo de sala: cada trecho conta uma vez, e não uma por pessoa nele.
      expect(stats.ms).toBe(3 * HOUR_MS);
      expect(stats.players.map((player) => [player.userId, player.ms])).toEqual([
        [A, 3 * HOUR_MS],
        [B, 2 * HOUR_MS],
        [C, HOUR_MS],
        [D, HOUR_MS],
      ]);
      expect(stats.formations.bySize.map((size) => [size.label, size.party])).toEqual([
        ['solo', 'partial'],
        ['dupla', 'partial'],
        ['quarteto', 'full'],
      ]);
      expect(stats.pairs[0]).toEqual({ userIds: [A, B], ms: 2 * HOUR_MS });
      expect(stats.formations.groups).toEqual([
        { userIds: [A, B], ms: HOUR_MS },
        { userIds: [A, B, C, D], ms: HOUR_MS },
      ]);
    });

    it('squad que ainda não jogou vem vazio', async () => {
      const s = scenario();
      const fresh = seedSquad({ gameId: s.game.id, name: 'Os Novos' });

      const stats = await s.service.squadStats(s.squad.guildId, fresh.id);

      expect(stats).toMatchObject({ played: 0, ms: 0 });
      expect(stats.players).toEqual([]);
      expect(stats.pairs).toEqual([]);
    });

    it('squad que não existe mais', async () => {
      const s = scenario();

      await expect(
        s.service.squadStats(s.squad.guildId, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toMatchObject({ code: 'NO_SQUAD' });
    });
  });
});
