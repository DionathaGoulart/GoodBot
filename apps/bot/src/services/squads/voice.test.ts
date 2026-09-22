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

  it('jogatina cancelada libera o voice vazio mesmo antes do início', async () => {
    const s = await scenario(30 * MINUTE_MS);
    store.sessions[0]!.cancelledAt = new Date(NOW);

    expect(await s.service.releaseEmptyVoice(s.discordGuild, s.voice.id)).toBe(true);
    expect(store.sessions[0]?.voiceReleasedAt).not.toBeNull();
  });

  it('quem já estava no voice quando a reserva saiu ganha presença na hora', async () => {
    const s = await scenario(30 * MINUTE_MS, { reserve: false });
    s.guild.putInVoice(A, s.voice.id);

    await s.service.remindSession(s.discordGuild, store.sessions[0]!);

    expect(store.sessions[0]?.voiceChannelId).toBe(s.voice.id);
    expect(store.attendance).toEqual([
      expect.objectContaining({ userId: A, joinedAt: new Date(NOW), leftAt: null }),
    ]);
    expect(store.sessions[0]?.playedAt).toEqual(new Date(NOW));
    expect(store.squads[0]).toMatchObject({ lastConfirmedAt: new Date(NOW), warnedAt: null });
  });

  it('quem já estava na sala no início, sem ser movido, ganha presença', async () => {
    const s = await scenario(0);
    s.guild.putInVoice(A, s.voice.id);

    await s.service.startSession(s.discordGuild, store.sessions[0]!);

    expect(store.attendance).toEqual([expect.objectContaining({ userId: A, leftAt: null })]);
  });

  it('quem entrou com o bot fora do ar ganha presença na varredura, uma vez só', async () => {
    const s = await scenario(-10 * MINUTE_MS);
    s.guild.putInVoice(A, s.voice.id);
    s.guild.putInVoice(C, s.voice.id);

    expect(await s.service.sweepPresence(s.discordGuild)).toEqual({ opened: 1, closed: 0 });
    s.clock.now += 5 * MINUTE_MS;
    expect(await s.service.sweepPresence(s.discordGuild)).toEqual({ opened: 0, closed: 0 });

    // C não é do squad; A fica com uma linha só.
    expect(store.attendance).toEqual([
      expect.objectContaining({ userId: A, joinedAt: new Date(NOW), leftAt: null }),
    ]);
  });

  it('presença aberta de quem saiu com o bot fora do ar fecha na varredura', async () => {
    const s = await scenario(-10 * MINUTE_MS);
    s.guild.putInVoice(A, s.voice.id);
    s.guild.putInVoice(B, s.voice.id);
    await s.service.confirmVoicePresence(s.discordGuild, s.voice.id, A);
    await s.service.confirmVoicePresence(s.discordGuild, s.voice.id, B);

    // A saiu sem o evento chegar; B foi para outro voice.
    s.guild.voiceStates.cache.delete(A);
    s.guild.putInVoice(B, s.voices[1]!.id);
    s.clock.now += 20 * MINUTE_MS;

    expect(await s.service.sweepPresence(s.discordGuild)).toEqual({ opened: 0, closed: 2 });
    expect(store.attendance.map((row) => row.leftAt)).toEqual([
      new Date(NOW + 20 * MINUTE_MS),
      new Date(NOW + 20 * MINUTE_MS),
    ]);
  });

  it('depois da liberação, quem continua no voice continua contando', async () => {
    const s = await scenario(-10 * MINUTE_MS);
    s.guild.putInVoice(A, s.voice.id);
    await s.service.confirmVoicePresence(s.discordGuild, s.voice.id, A);
    await s.service.releaseVoice(s.discordGuild, store.sessions[0]!);

    expect(await s.service.sweepPresence(s.discordGuild)).toEqual({ opened: 0, closed: 0 });
    expect(store.attendance[0]?.leftAt).toBeNull();
  });

  it('a jogatina seguinte na mesma sala fica com a presença de quem não saiu', async () => {
    const s = await scenario(-4 * HOUR_MS);
    const first = store.sessions[0]!;
    s.guild.putInVoice(A, s.voice.id);
    await s.service.confirmVoicePresence(s.discordGuild, s.voice.id, A);
    await s.service.releaseVoice(s.discordGuild, first);

    const next = seedSession({
      squadId: s.squad.id,
      startsAt: new Date(NOW + 30 * MINUTE_MS),
      endsAt: new Date(NOW + 3 * HOUR_MS),
    });
    await s.service.reserveVoice(s.discordGuild, next);
    s.clock.now += MINUTE_MS;

    expect(await s.service.sweepPresence(s.discordGuild)).toEqual({ opened: 1, closed: 1 });
    expect(store.attendance).toEqual([
      expect.objectContaining({ sessionId: first.id, leftAt: new Date(NOW + MINUTE_MS) }),
      expect.objectContaining({ sessionId: next.id, joinedAt: new Date(NOW + MINUTE_MS) }),
    ]);
  });

  it('fora da janela de presença, ou com a jogatina cancelada, a varredura não abre', async () => {
    const s = await scenario(2 * HOUR_MS);
    s.guild.putInVoice(A, s.voice.id);

    expect(await s.service.sweepPresence(s.discordGuild)).toEqual({ opened: 0, closed: 0 });

    s.clock.now += 90 * MINUTE_MS;
    store.sessions[0]!.cancelledAt = new Date(s.clock.now);
    expect(await s.service.sweepPresence(s.discordGuild)).toEqual({ opened: 0, closed: 0 });
    expect(store.attendance).toEqual([]);
  });

  it('com gente no voice a reserva fica', async () => {
    const s = await scenario(-10 * MINUTE_MS);
    s.voice.members.set(A, { id: A, user: { bot: false } });

    expect(await s.service.releaseEmptyVoice(s.discordGuild, s.voice.id)).toBe(false);
    expect(store.sessions[0]?.voiceReleasedAt).toBeNull();
  });
});
