import { HOUR_MS, MINUTE_MS } from '@goodbot/shared';
import { OverwriteType, PermissionFlagsBits } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BOT_ID,
  componentsOf,
  discordError,
  embedOf,
  fakeTextChannel,
  fakeThread,
  fakeVoice,
  overwritesOf,
} from './__fixtures__/discord';
import { A, B, C, createHarness, NOW } from './__fixtures__/harness';
import { ABSENT_OVERWRITE_TYPE, SQUAD_VOICE_MEMBER_BITS, squadTextOverwrites } from './overwrites';

import type { FakeMessage, FakeThread, FakeVoice } from './__fixtures__/discord';
import type { ExactOverwrite } from '../../lib/overwrites';
import type { APIActionRowComponent, APIButtonComponent } from 'discord.js';

const fixtures = await vi.hoisted(async () => import('./__fixtures__/fake-db'));
vi.mock('@goodbot/db', () => fixtures.repositories);

const { store, repositories, seedGame, seedMember, seedSession, seedSquad, GUILD_ID } = fixtures;

/** Convidados: gente do servidor que não é do squad. */
const G1 = '300000000000000011';
const G2 = '300000000000000012';
const G3 = '300000000000000013';

/** O voice como estava antes de qualquer reserva. */
const BEFORE: ExactOverwrite[] = [
  {
    id: GUILD_ID,
    type: OverwriteType.Role,
    allow: PermissionFlagsBits.Connect,
    deny: 0n,
  },
];

/**
 * Squad de A e B (jogo de 4 por partida) com um voice no pool e uma jogatina
 * daqui a 30 minutos, que A marcou e vai.
 */
function scenario() {
  const harness = createHarness();
  const voice = harness.guild.add(fakeVoice({ overwrites: BEFORE }));
  harness.setConfig({ voicePoolIds: [voice.id] });
  const game = seedGame({ groupSize: 4, partySize: 4 });
  const channel = harness.guild.add(
    fakeTextChannel({
      overwrites: squadTextOverwrites({ everyoneId: GUILD_ID, botId: BOT_ID, memberIds: [A, B] }),
    }),
  );
  const squad = seedSquad({ gameId: game.id, textChannelId: channel.id, voiceChannelId: voice.id });
  seedMember(squad.id, A);
  seedMember(squad.id, B);
  const session = seedSession({
    squadId: squad.id,
    startsAt: new Date(NOW + 30 * MINUTE_MS),
    endsAt: new Date(NOW + 3 * HOUR_MS + 30 * MINUTE_MS),
    createdBy: A,
    goingIds: [A],
  });
  return { ...harness, voice, game, channel, squad, session };
}
type Scenario = ReturnType<typeof scenario>;

const sessionRow = () => store.sessions[0]!;

/** A jogatina com mensagem no canal, como se tivesse sido anunciada. */
async function announced(s: Scenario): Promise<FakeMessage> {
  const message = await s.channel.send({ content: 'jogatina' });
  sessionRow().messageId = message.id;
  return message;
}

const bring = (s: Scenario, userId: string, by = A, bot = false) =>
  s.service.bringGuest(s.discordGuild, sessionRow().id, by, { id: userId, bot }, 'event');

const overwriteOf = (voice: FakeVoice, id: string) =>
  overwritesOf(voice.permissionOverwrites).find((overwrite) => overwrite.id === id);

/** A thread do convite de quem foi trazido em `index`º lugar. */
const threadOf = (s: Scenario, index = 0) => s.search.threads.created[index] as FakeThread;

function buttonLabels(message: FakeMessage | undefined): string[] {
  return componentsOf(message).flatMap((row) =>
    (
      (row as { toJSON(): APIActionRowComponent<APIButtonComponent> }).toJSON().components as {
        label?: string;
      }[]
    ).map((button) => button.label ?? ''),
  );
}

describe('SquadService: TRAZER CONVIDADO', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('grava o convidado, abre a thread com ele e quem trouxe e mostra na jogatina', async () => {
    const s = scenario();
    const message = await announced(s);

    const result = await bring(s, G1);

    expect(store.guests).toEqual([
      expect.objectContaining({ sessionId: sessionRow().id, userId: G1, invitedBy: A }),
    ]);
    const thread = threadOf(s);
    expect(s.search.threads.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'jogatina-squad-teste', invitable: false }),
    );
    expect(thread.members.add.mock.calls.map(([id]) => id)).toEqual([G1, A]);
    expect(store.guests[0]?.threadId).toBe(thread.id);
    expect(result).toMatchObject({ guestId: G1, threadId: thread.id, voiceChannelId: null });

    const invite = thread.sent[0]!;
    expect(invite.payload.content).toBe(`<@${G1}>`);
    expect(invite.payload.allowedMentions).toEqual({ users: [G1] });
    expect(embedOf(invite)?.description).toContain(`<@${A}> chamou você para jogar`);

    const fields = embedOf(message)?.fields ?? [];
    expect(fields.find((field) => field.name === 'Convidados')?.value).toBe(`<@${G1}>`);
    expect(fields.find((field) => field.name === 'Party')?.value).toBe('2 de 4, ainda cabe gente.');
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'squad.session.guest',
        actor: A,
        target: { type: 'member', id: G1 },
      }),
    );
  });

  it('o botão confere quem clicou antes de abrir o select', async () => {
    const s = scenario();
    await expect(
      s.service.guestPickMessage(s.discordGuild, sessionRow().id, C),
    ).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
    const pick = await s.service.guestPickMessage(s.discordGuild, sessionRow().id, B);
    expect(pick.content).toContain('sem entrar no squad');
  });

  it.each([
    ['um bot', () => [G1, A, true] as const, 'GUEST_BOT'],
    ['alguém do squad', () => [B, A, false] as const, 'ALREADY_MEMBER'],
    ['quem não é do squad trazendo', () => [G1, C, false] as const, 'NOT_A_MEMBER'],
  ])('recusa %s', async (_label, args, code) => {
    const s = scenario();
    const [userId, by, bot] = args();
    await expect(bring(s, userId, by, bot)).rejects.toMatchObject({ code });
    expect(store.guests).toEqual([]);
    expect(s.search.threads.create).not.toHaveBeenCalled();
  });

  it('recusa convidado repetido, fora do servidor e além do teto', async () => {
    const s = scenario();
    s.setConfig({ maxSessionGuests: 1 });
    const message = await announced(s);
    await bring(s, G1);
    await expect(bring(s, G1)).rejects.toMatchObject({ code: 'GUEST_EXISTS' });
    await expect(bring(s, G2)).rejects.toMatchObject({ code: 'GUEST_LIMIT' });
    // Com o teto cheio, o botão sai da mensagem.
    expect(buttonLabels(message)).not.toContain('TRAZER CONVIDADO');

    s.setConfig({ maxSessionGuests: 2 });
    s.guild.leave(G2);
    await expect(bring(s, G2)).rejects.toMatchObject({ code: 'NOT_IN_GUILD' });
  });

  it('desligado no servidor (teto 0), o botão some e o select não abre', async () => {
    const s = scenario();
    s.setConfig({ maxSessionGuests: 0 });
    await expect(
      s.service.guestPickMessage(s.discordGuild, sessionRow().id, A),
    ).rejects.toMatchObject({ code: 'GUESTS_DISABLED' });
    const { session } = await s.service.scheduleSession(
      s.discordGuild,
      s.squad.id,
      A,
      'amanhã 21h',
      'event',
    );
    const message = s.channel.sent.find((sent) => sent.id === session.messageId);
    expect(buttonLabels(message)).not.toContain('TRAZER CONVIDADO');
  });

  it('jogatina cancelada, acabada ou esvaziada depois do início não aceita convidado', async () => {
    const s = scenario();
    sessionRow().cancelledAt = new Date(NOW);
    await expect(bring(s, G1)).rejects.toMatchObject({ code: 'SESSION_CANCELLED' });

    sessionRow().cancelledAt = null;
    await s.service.reserveVoice(s.discordGuild, sessionRow());
    s.clock.now = sessionRow().startsAt.getTime();
    await s.service.startSession(s.discordGuild, sessionRow());
    // Rolando, ainda aceita.
    await bring(s, G1);
    // O voice esvaziou: a reserva sai e a jogatina acabou.
    await s.service.releaseVoice(s.discordGuild, sessionRow());
    await expect(bring(s, G2)).rejects.toMatchObject({ code: 'SESSION_ENDED' });

    s.clock.now = sessionRow().endsAt.getTime();
    await expect(
      s.service.guestPickMessage(s.discordGuild, sessionRow().id, A),
    ).rejects.toMatchObject({ code: 'SESSION_ENDED' });
  });

  it('a thread que não sai desfaz o convidado; quem trouxe fora da thread não', async () => {
    const s = scenario();
    const broken = s.guild.add(fakeThread());
    broken.send.mockRejectedValueOnce(discordError('Missing Access', 50001));
    s.search.threads.create.mockResolvedValueOnce(broken);

    await expect(bring(s, G1)).rejects.toMatchObject({ code: 'GUEST_FAILED' });
    expect(store.guests).toEqual([]);
    expect(broken.delete).toHaveBeenCalled();

    const partial = s.guild.add(fakeThread());
    partial.members.add
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(discordError('Missing Access', 50001));
    s.search.threads.create.mockResolvedValueOnce(partial);
    await bring(s, G1);
    expect(store.guests).toEqual([expect.objectContaining({ userId: G1, threadId: partial.id })]);
    expect(partial.sent).toHaveLength(1);
  });

  it('sem canal de busca utilizável, explica e não grava nada', async () => {
    const s = scenario();
    s.setConfig({ searchChannelId: null });
    await expect(bring(s, G1)).rejects.toMatchObject({ code: 'SEARCH_CHANNEL_UNAVAILABLE' });
    expect(store.guests).toEqual([]);
  });
});

describe('SquadService: o voice do convidado', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('com a sala já reservada: o snapshot guarda o convidado antes da concessão, e a liberação devolve', async () => {
    const s = scenario();
    const original = overwritesOf(s.voice.permissionOverwrites);
    await s.service.reserveVoice(s.discordGuild, sessionRow());
    s.voice.permissionOverwrites.edit.mockClear();

    const result = await bring(s, G1);

    expect(result.voiceChannelId).toBe(s.voice.id);
    expect(overwriteOf(s.voice, G1)?.allow).toBe(SQUAD_VOICE_MEMBER_BITS);
    const [appendOrder] = repositories.appendSessionVoiceSnapshot.mock.invocationCallOrder;
    const [grantOrder] = s.voice.permissionOverwrites.edit.mock.invocationCallOrder;
    expect(appendOrder).toBeLessThan(grantOrder!);
    expect(sessionRow().voiceOverwrites).toContainEqual({
      id: G1,
      type: ABSENT_OVERWRITE_TYPE,
      allow: '0',
      deny: '0',
    });
    expect(embedOf(threadOf(s).sent[0])?.fields?.[0]?.value).toContain(
      `<#${s.voice.id}>, já liberada para você`,
    );

    expect(await s.service.releaseVoice(s.discordGuild, sessionRow())).toBe(true);
    expect(overwritesOf(s.voice.permissionOverwrites)).toEqual(original);
  });

  it('trazido antes da reserva: a reserva já inclui o convidado, e a liberação devolve', async () => {
    const s = scenario();
    const original = overwritesOf(s.voice.permissionOverwrites);
    await bring(s, G1);
    expect(overwriteOf(s.voice, G1)).toBeUndefined();

    await s.service.reserveVoice(s.discordGuild, sessionRow());
    expect(overwriteOf(s.voice, G1)?.allow).toBe(SQUAD_VOICE_MEMBER_BITS);
    expect(sessionRow().voiceOverwrites?.some((overwrite) => overwrite.id === G1)).toBe(true);

    await s.service.releaseVoice(s.discordGuild, sessionRow());
    expect(overwritesOf(s.voice.permissionOverwrites)).toEqual(original);
  });

  it('o voice temporário nasce com o convidado dentro', async () => {
    const s = scenario();
    s.setConfig({ voicePoolIds: [] });
    await bring(s, G1);

    const voiceId = await s.service.reserveVoice(s.discordGuild, sessionRow());

    const temporary = s.guild.channels.cache.get(voiceId ?? '') as FakeVoice;
    expect(overwriteOf(temporary, G1)?.allow).toBe(SQUAD_VOICE_MEMBER_BITS);
  });
});

describe('SquadService: presença e avisos do convidado', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a presença do convidado conta à parte e não faz a jogatina ter rolado', async () => {
    const s = scenario();
    await s.service.reserveVoice(s.discordGuild, sessionRow());
    await bring(s, G1);

    expect(await s.service.confirmVoicePresence(s.discordGuild, s.voice.id, G1)).toBe(true);
    expect(store.attendance).toEqual([expect.objectContaining({ userId: G1, asGuest: true })]);
    expect(sessionRow().playedAt).toBeNull();
    expect(store.squads[0]?.lastConfirmedAt).toBeNull();
    // Quem não é do squad nem convidado continua de fora.
    expect(await s.service.confirmVoicePresence(s.discordGuild, s.voice.id, G2)).toBe(false);

    // A varredura acha o convidado que já estava na sala, também à parte.
    await s.service.recordVoiceLeave(s.discordGuild, G1);
    s.guild.putInVoice(G1, s.voice.id);
    s.clock.now += MINUTE_MS;
    expect(await s.service.sweepPresence(s.discordGuild)).toEqual({ opened: 1, closed: 0 });
    expect(store.attendance.filter((row) => row.leftAt === null)).toEqual([
      expect.objectContaining({ userId: G1, asGuest: true }),
    ]);
    expect(sessionRow().playedAt).toBeNull();

    // O histórico é do squad: o convidado não entra em quem mais aparece.
    s.guild.putInVoice(A, s.voice.id);
    await s.service.sweepPresence(s.discordGuild);
    expect(sessionRow().playedAt).not.toBeNull();
    const { summary } = await s.parts.history.one(GUILD_ID, s.squad.id);
    expect(summary.regulars.map((regular) => regular.userId)).toEqual([A]);
  });

  it('no início, o convidado é avisado na thread e não é movido', async () => {
    const s = scenario();
    await s.service.reserveVoice(s.discordGuild, sessionRow());
    await bring(s, G1);
    const elsewhere = s.guild.add(fakeVoice());
    const state = s.guild.putInVoice(G1, elsewhere.id);
    s.clock.now = sessionRow().startsAt.getTime();

    await s.service.startSession(s.discordGuild, sessionRow());

    expect(state.setChannel).not.toHaveBeenCalled();
    const notice = threadOf(s).sent.at(-1)!;
    expect(notice.payload.content).toBe(
      `<@${G1}> a jogatina do **Squad Teste** começou! Entre em <#${s.voice.id}>.`,
    );
  });

  it('remarcar e cancelar avisam o convidado na thread', async () => {
    const s = scenario();
    const { session } = await s.service.scheduleSession(
      s.discordGuild,
      s.squad.id,
      A,
      'hoje 21h',
      'event',
    );
    await s.service.bringGuest(s.discordGuild, session.id, A, { id: G1, bot: false }, 'event');
    const thread = threadOf(s);

    await s.service.rescheduleSession(s.discordGuild, session.id, A, 'hoje 22h', 'event');
    expect(thread.sent.at(-1)?.payload.content).toContain('foi remarcada');

    await s.service.cancelSession(s.discordGuild, session.id, A, 'event');
    expect(thread.sent.at(-1)?.payload.content).toContain('foi cancelada');
  });

  it('convidado ocupa lugar na party: com ela cheia, CHAMAR GENTE sai', async () => {
    const s = scenario();
    const message = await announced(s);
    await bring(s, G1);
    await bring(s, G2);
    expect(buttonLabels(message)).toContain('CHAMAR GENTE');

    await bring(s, G3);

    expect(buttonLabels(message)).not.toContain('CHAMAR GENTE');
    await expect(
      s.service.callForPlayers(s.discordGuild, sessionRow().id, A, 'event'),
    ).rejects.toMatchObject({ code: 'PARTY_FULL' });
  });
});
