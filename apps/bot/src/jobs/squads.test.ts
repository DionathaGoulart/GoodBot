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
function jobScenario(slot: { day: number; block: number }, options: { createdAt?: Date } = {}) {
  const harness = createHarness();
  const game = seedGame();
  const channel = harness.guild.add(fakeTextChannel());
  const squad = seedSquad({
    gameId: game.id,
    textChannelId: channel.id,
    ...slot,
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
  return { ...harness, game, channel, squad, job, run: () => job.runFor(harness.discordGuild) };
}

/** Segunda à tarde: 12h às 18h em São Paulo, 15h às 21h UTC. */
const MONDAY_AFTERNOON = { day: 1, block: 1 };
/** Quinta à noite: longe de tudo o que os testes de inatividade fazem. */
const THURSDAY_NIGHT = { day: 4, block: 2 };

describe('SquadsJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('agenda a sessão e só lembra dentro da antecedência, uma vez, com uma reserva só', async () => {
    const s = jobScenario(MONDAY_AFTERNOON);

    s.clock.now = at('2026-09-14T14:00:00Z');
    expect(await s.run()).toMatchObject({ scheduled: 1, reminded: 0 });
    expect(store.sessions).toEqual([
      expect.objectContaining({ startsAt: new Date('2026-09-14T15:00:00Z') }),
    ]);

    s.clock.now = at('2026-09-14T14:40:00Z');
    expect(await s.run()).toMatchObject({ scheduled: 1, reminded: 1 });
    s.clock.now = at('2026-09-14T14:45:00Z');
    expect(await s.run()).toMatchObject({ reminded: 0 });

    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0]?.voiceChannelId).toBe(s.voices[0]!.id);
    expect(s.channel.sent).toHaveLength(1);
    expect(s.voices[0]!.permissionOverwrites.set).toHaveBeenCalledTimes(1);
  });

  it('na hora começa e move quem está em outro voice; no fim da faixa libera uma vez', async () => {
    const s = jobScenario(MONDAY_AFTERNOON);
    s.clock.now = at('2026-09-14T14:40:00Z');
    await s.run();
    const inOtherVoice = s.guild.putInVoice(A, s.voices[1]!.id);

    s.clock.now = at('2026-09-14T15:00:00Z');
    expect(await s.run()).toMatchObject({ started: 1, released: 0 });
    expect(inOtherVoice.setChannel).toHaveBeenCalledWith(s.voices[0]!.id, expect.any(String));

    s.clock.now = at('2026-09-14T21:00:00Z');
    expect(await s.run()).toMatchObject({ started: 0, released: 1 });
    s.clock.now = at('2026-09-14T21:05:00Z');
    expect(await s.run()).toMatchObject({ released: 0 });

    const monday = store.sessions.find(
      (session) => session.startsAt.getTime() === at('2026-09-14T15:00:00Z'),
    );
    expect(monday?.voiceReleasedAt).not.toBeNull();
    expect(s.voices[0]!.permissionOverwrites.set).toHaveBeenCalledTimes(2);
  });

  it('inatividade: avisa na 4ª semana, não repete no mesmo dia e arquiva uma semana depois', async () => {
    const s = jobScenario(THURSDAY_NIGHT, { createdAt: new Date(NOW - 4 * WEEK_MS - DAY_MS) });

    // 9h locais: antes da hora do passo diário.
    expect(await s.run()).toMatchObject({ daily: false });
    expect(store.squads[0]?.warnedAt).toBeNull();

    s.clock.now = at('2026-09-14T15:30:00Z');
    expect(await s.run()).toMatchObject({ daily: true });
    expect(store.squads[0]?.warnedAt).not.toBeNull();

    s.clock.now += HOUR_MS;
    expect(await s.run()).toMatchObject({ daily: false });
    expect(store.squads[0]?.status).toBe('open');

    s.clock.now = at('2026-09-21T15:30:00Z');
    expect(await s.run()).toMatchObject({ daily: true });
    expect(store.squads[0]?.status).toBe('archived');
  });

  it('módulo desligado: a guild é pulada sem tocar o banco', async () => {
    const s = jobScenario(MONDAY_AFTERNOON);
    s.setConfig({ enabled: false });
    s.clock.now = at('2026-09-14T15:30:00Z');

    expect(await s.run()).toBeNull();
    expect(repositories.upsertSquadSession).not.toHaveBeenCalled();
    expect(store.meta.size).toBe(0);
  });

  it('um passo que falha não impede os seguintes', async () => {
    const s = jobScenario(MONDAY_AFTERNOON);
    vi.spyOn(s.service, 'expireProposals').mockRejectedValueOnce(new Error('banco fora'));
    s.clock.now = at('2026-09-14T14:40:00Z');

    expect(await s.run()).toMatchObject({ expired: 0, scheduled: 1, reminded: 1 });
  });

  it('a passada percorre só as guilds atendidas que estão no cache', async () => {
    const s = jobScenario(MONDAY_AFTERNOON);
    const job = new SquadsJob({
      db: fixtures.fakeDb,
      client: s.client,
      config: s.configService as unknown as ConfigService,
      squads: s.service,
      guildIds: () => ['900000000000000123', GUILD_ID],
      now: () => s.clock.now + 30 * MINUTE_MS,
    });

    await job.tick();

    expect(s.configService.get).toHaveBeenCalledWith(GUILD_ID, 'squads');
    expect(s.configService.get).not.toHaveBeenCalledWith('900000000000000123', 'squads');
    expect(store.sessions).toHaveLength(1);
  });
});
