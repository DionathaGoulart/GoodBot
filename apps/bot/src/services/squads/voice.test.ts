import { HOUR_MS, MINUTE_MS } from '@goodbot/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeTextChannel, fakeVoice } from './__fixtures__/discord';
import { A, B, C, createHarness, NOW } from './__fixtures__/harness';

const fixtures = await vi.hoisted(async () => import('./__fixtures__/fake-db'));
vi.mock('@goodbot/db', () => fixtures.repositories);

const { store, seedGame, seedMember, seedSession, seedSquad } = fixtures;

/** Squad avisado de inatividade, com sessão cujo início está a `startsInMs` de agora. */
async function scenario(startsInMs: number, options: { reserve?: boolean } = {}) {
  const harness = createHarness();
  const voice = harness.guild.add(fakeVoice());
  harness.setConfig({ voicePoolIds: [voice.id] });
  const game = seedGame();
  const channel = harness.guild.add(fakeTextChannel());
  const squad = seedSquad({
    gameId: game.id,
    textChannelId: channel.id,
    voiceChannelId: voice.id,
    warnedAt: new Date(NOW - HOUR_MS),
  });
  seedMember(squad.id, A);
  seedMember(squad.id, B);
  const session = seedSession({
    squadId: squad.id,
    startsAt: new Date(NOW + startsInMs),
    endsAt: new Date(NOW + startsInMs + 6 * HOUR_MS),
  });
  if (options.reserve !== false) {
    expect(await harness.service.reserveVoice(harness.discordGuild, session)).toBe(voice.id);
  }
  return { ...harness, voice, squad };
}

describe('SquadService: evento de voz', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('membro no voice reservado confirma o squad e desfaz o aviso', async () => {
    const s = await scenario(30 * MINUTE_MS);

    expect(await s.service.confirmVoicePresence(s.discordGuild, s.voice.id, A)).toBe(true);

    expect(store.squads[0]).toMatchObject({ lastConfirmedAt: new Date(NOW), warnedAt: null });
  });

  it('quem não é do squad não confirma nada', async () => {
    const s = await scenario(30 * MINUTE_MS);

    expect(await s.service.confirmVoicePresence(s.discordGuild, s.voice.id, C)).toBe(false);
    expect(store.squads[0]?.lastConfirmedAt).toBeNull();
    expect(store.attendance).toEqual([]);
  });

  it('a presença no voice reservado abre uma linha por entrada, e sair fecha', async () => {
    const s = await scenario(-10 * MINUTE_MS);

    await s.service.confirmVoicePresence(s.discordGuild, s.voice.id, A);
    expect(store.attendance).toEqual([
      expect.objectContaining({ sessionId: store.sessions[0]!.id, userId: A, leftAt: null }),
    ]);
    expect(store.sessions[0]?.playedAt).toEqual(new Date(NOW));

    s.clock.now += 20 * MINUTE_MS;
    expect(await s.service.recordVoiceLeave(s.discordGuild, A)).toBe(1);
    expect(store.attendance[0]?.leftAt).toEqual(new Date(NOW + 20 * MINUTE_MS));
    expect(await s.service.recordVoiceLeave(s.discordGuild, A)).toBe(0);

    // Voltou: outra linha, e a primeira continua fechada.
    s.clock.now += 5 * MINUTE_MS;
    await s.service.confirmVoicePresence(s.discordGuild, s.voice.id, A);
    expect(store.attendance.map((row) => row.leftAt === null)).toEqual([false, true]);
  });

  it('voice sem reserva viva não conta como sessão', async () => {
    const s = await scenario(30 * MINUTE_MS, { reserve: false });

    expect(await s.service.confirmVoicePresence(s.discordGuild, s.voice.id, A)).toBe(false);
  });

  it('voice vazio depois do início libera a reserva', async () => {
    const s = await scenario(-10 * MINUTE_MS);
    s.voice.members.set(C, { id: C, user: { bot: true } });

    expect(await s.service.releaseEmptyVoice(s.discordGuild, s.voice.id)).toBe(true);
    expect(store.sessions[0]?.voiceReleasedAt).not.toBeNull();
  });

  it('antes do início a reserva fica, mesmo com o voice vazio', async () => {
    const s = await scenario(30 * MINUTE_MS);

    expect(await s.service.releaseEmptyVoice(s.discordGuild, s.voice.id)).toBe(false);
    expect(store.sessions[0]?.voiceReleasedAt).toBeNull();
  });

  it('com gente no voice a reserva fica', async () => {
    const s = await scenario(-10 * MINUTE_MS);
    s.voice.members.set(A, { id: A, user: { bot: false } });

    expect(await s.service.releaseEmptyVoice(s.discordGuild, s.voice.id)).toBe(false);
    expect(store.sessions[0]?.voiceReleasedAt).toBeNull();
  });
});
