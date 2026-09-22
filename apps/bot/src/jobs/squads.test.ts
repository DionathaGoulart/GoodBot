import { DAY_MS, HOUR_MS, MINUTE_MS, WEEK_MS } from '@goodbot/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SquadsJob } from './squads';
import { fakeTextChannel } from '../services/squads/__fixtures__/discord';
import { A, B, createHarness, NOW } from '../services/squads/__fixtures__/harness';

import type { ConfigService } from '../services/config';

const fixtures = await vi.hoisted(async () => import('../services/squads/__fixtures__/fake-db'));
vi.mock('@goodbot/db', () => fixtures.repositories);

const { store, repositories, seedGame, seedMember, seedSquad, GUILD_ID } = fixtures;

const at = (iso: string) => Date.parse(iso);

/**
 * Um squad de A e B no fuso de São Paulo. O relógio começa na segunda,
 * 14/09/2026, meio-dia UTC (9h locais).
 */
function jobScenario(options: { createdAt?: Date } = {}) {
  const harness = createHarness();
  const game = seedGame();
  const channel = harness.guild.add(fakeTextChannel());
  const squad = seedSquad({
    gameId: game.id,
    textChannelId: channel.id,
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
  });
  seedMember(squad.id, A);
  seedMember(squad.id, B);
  const job = new SquadsJob({
    db: fixtures.fakeDb,
    client: harness.client,
    config: harness.configService as unknown as ConfigService,
    squads: harness.service,
    guildIds: () => [GUILD_ID],
    now: () => harness.clock.now,
  });
  const schedule = (when: string) =>
    harness.service.scheduleSession(harness.discordGuild, squad.id, A, when, 'command');
  return { ...harness, game, channel, squad, job, schedule, run: () => job.runFor(harness.discordGuild) };
}

describe('SquadsJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('não marca jogatina sozinho', async () => {
    const s = jobScenario();
    s.clock.now = at('2026-09-19T23:00:00Z');

    await s.run();

    expect(store.sessions).toEqual([]);
  });

  it('lembra só dentro da antecedência, uma vez, com uma reserva só', async () => {
    const s = jobScenario();
    // Hoje 12h em São Paulo: 15h UTC.
    await s.schedule('hoje 12h');

    s.clock.now = at('2026-09-14T14:00:00Z');
    expect(await s.run()).toMatchObject({ reminded: 0 });

    s.clock.now = at('2026-09-14T14:40:00Z');
    expect(await s.run()).toMatchObject({ reminded: 1 });
    s.clock.now = at('2026-09-14T14:45:00Z');
    expect(await s.run()).toMatchObject({ reminded: 0 });

    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0]?.voiceChannelId).toBe(s.voices[0]!.id);
    const reminders = s.channel.sent.filter((message) =>
      String(message.payload.content).includes('começa'),
    );
    expect(reminders).toHaveLength(1);
    expect(s.voices[0]!.permissionOverwrites.set).toHaveBeenCalledTimes(1);
  });

  it('na hora começa e move quem está em outro voice; no fim da jogatina libera uma vez', async () => {
    const s = jobScenario();
    await s.schedule('hoje 12h');
    s.clock.now = at('2026-09-14T14:40:00Z');
    await s.run();
    const inOtherVoice = s.guild.putInVoice(A, s.voices[1]!.id);

    s.clock.now = at('2026-09-14T15:00:00Z');
    expect(await s.run()).toMatchObject({ started: 1, released: 0 });
    expect(inOtherVoice.setChannel).toHaveBeenCalledWith(s.voices[0]!.id, expect.any(String));

    // Três horas de jogatina: 15h às 18h UTC.
    s.clock.now = at('2026-09-14T18:00:00Z');
    expect(await s.run()).toMatchObject({ started: 0, released: 1 });
    s.clock.now = at('2026-09-14T18:05:00Z');
    expect(await s.run()).toMatchObject({ released: 0 });

    expect(store.sessions[0]?.voiceReleasedAt).not.toBeNull();
    expect(s.voices[0]!.permissionOverwrites.set).toHaveBeenCalledTimes(2);
  });

  it('a chamada pública fica no ar durante a jogatina e sai no fim', async () => {
    const s = jobScenario();
    const { session } = await s.schedule('hoje 12h');
    await s.service.callForPlayers(s.discordGuild, session.id, A, 'event');
    const call = s.search.sent[0]!;

    s.clock.now = at('2026-09-14T15:00:00Z');
    expect(await s.run()).toMatchObject({ started: 1, calls: 0 });
    expect(call.deleted).toBe(false);

    // A sala é liberada no fim e leva a chamada junto: nada sobra para o passo.
    s.clock.now = at('2026-09-14T18:00:00Z');
    expect(await s.run()).toMatchObject({ released: 1, calls: 0 });
    expect(call.deleted).toBe(true);
    expect(store.sessions[0]?.callMessageId).toBeNull();
  });

  it('a chamada de uma jogatina sem sala sai do ar no fim previsto', async () => {
    const s = jobScenario();
    const { session } = await s.schedule('hoje 12h');
    await s.service.callForPlayers(s.discordGuild, session.id, A, 'event');
    const call = s.search.sent[0]!;
    // Sem reserva: começa sem sala, e não há liberação que feche a chamada.
    s.clock.now = at('2026-09-14T15:00:00Z');
    await s.service.startSession(s.discordGuild, store.sessions[0]!);

    s.clock.now = at('2026-09-14T18:00:00Z');
    expect(await s.run()).toMatchObject({ calls: 1 });

    expect(call.deleted).toBe(true);
    expect(await s.run()).toMatchObject({ calls: 0 });
  });

  it('cada passada acerta a presença com quem está no voice reservado', async () => {
    const s = jobScenario();
    await s.schedule('hoje 12h');
    s.clock.now = at('2026-09-14T14:40:00Z');
    await s.run();

    // B entra com o bot fora do ar: nenhum evento chegou.
    s.guild.putInVoice(B, s.voices[0]!.id);
    s.clock.now = at('2026-09-14T14:45:00Z');
    expect(await s.run()).toMatchObject({ swept: 1 });
    expect(store.attendance).toEqual([
      expect.objectContaining({ userId: B, joinedAt: new Date(s.clock.now), leftAt: null }),
    ]);

    // E sai do mesmo jeito.
    s.guild.voiceStates.cache.delete(B);
    s.clock.now = at('2026-09-14T14:50:00Z');
    expect(await s.run()).toMatchObject({ swept: 1 });
    expect(store.attendance[0]?.leftAt).toEqual(new Date(s.clock.now));
    expect(await s.run()).toMatchObject({ swept: 0 });
  });

  it('jogatina cancelada não é lembrada nem começa', async () => {
    const s = jobScenario();
    const { session } = await s.schedule('hoje 12h');
    await s.service.cancelSession(s.discordGuild, session.id, A, 'event');

    s.clock.now = at('2026-09-14T15:00:00Z');
    expect(await s.run()).toMatchObject({ reminded: 0, started: 0 });
  });

  it('passo diário: inatividade, guias em dia e não repete no mesmo dia', async () => {
    const s = jobScenario({ createdAt: new Date(NOW - 4 * WEEK_MS - DAY_MS) });

    // 9h locais: antes da hora do passo diário.
    expect(await s.run()).toMatchObject({ daily: false, guides: 0 });
    expect(store.squads[0]?.warnedAt).toBeNull();

    s.clock.now = at('2026-09-14T15:30:00Z');
    expect(await s.run()).toMatchObject({ daily: true, guides: 1 });
    expect(store.squads[0]?.warnedAt).not.toBeNull();
    expect(store.squads[0]?.guideMessageId).not.toBeNull();

    s.clock.now += HOUR_MS;
    expect(await s.run()).toMatchObject({ daily: false });
    expect(store.squads[0]?.status).toBe('open');

    s.clock.now = at('2026-09-21T15:30:00Z');
    expect(await s.run()).toMatchObject({ daily: true, guides: 0 });
    expect(store.squads[0]?.status).toBe('archived');
  });

  it('módulo desligado: a guild é pulada sem tocar o banco', async () => {
    const s = jobScenario();
    s.setConfig({ enabled: false });
    s.clock.now = at('2026-09-14T15:30:00Z');

    expect(await s.run()).toBeNull();
    expect(repositories.listSessionsStartingBetween).not.toHaveBeenCalled();
    expect(store.meta.size).toBe(0);
  });

  it('um passo que falha não impede os seguintes', async () => {
    const s = jobScenario();
    await s.schedule('hoje 12h');
    vi.spyOn(s.service, 'expireProposals').mockRejectedValueOnce(new Error('banco fora'));
    s.clock.now = at('2026-09-14T14:40:00Z');

    expect(await s.run()).toMatchObject({ expired: 0, reminded: 1 });
  });

  it('a passada percorre só as guilds atendidas que estão no cache', async () => {
    const s = jobScenario();
    await s.schedule('hoje 9h20');
    s.clock.now = NOW + 10 * MINUTE_MS;
    store.sessions[0]!.remindedAt = null;
    const job = new SquadsJob({
      db: fixtures.fakeDb,
      client: s.client,
      config: s.configService as unknown as ConfigService,
      squads: s.service,
      guildIds: () => ['900000000000000123', GUILD_ID],
      now: () => s.clock.now,
    });

    await job.tick();

    expect(s.configService.get).toHaveBeenCalledWith(GUILD_ID, 'squads');
    expect(s.configService.get).not.toHaveBeenCalledWith('900000000000000123', 'squads');
    expect(store.sessions[0]?.remindedAt).not.toBeNull();
  });
});
