import { HOUR_MS } from '@goodbot/shared';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ALL_BUT_ADMIN,
  BOT_ID,
  componentsOf,
  embedOf,
  fakeTextChannel,
} from './__fixtures__/discord';
import { A, B, C, createHarness, D } from './__fixtures__/harness';
import { parseSquadCustomId } from './ids';
import { squadTextOverwrites } from './overwrites';

import type { FakeMessage } from './__fixtures__/discord';

const fixtures = await vi.hoisted(async () => import('./__fixtures__/fake-db'));
vi.mock('@goodbot/db', () => fixtures.repositories);

const { store, seedGame, seedMember, seedSquad, GUILD_ID } = fixtures;

/** Squad de A e B, jogo de 4 por squad e por party. */
function scenario(options: { groupSize?: number; partySize?: number } = {}) {
  const harness = createHarness();
  const game = seedGame({
    groupSize: options.groupSize ?? 4,
    partySize: options.partySize ?? options.groupSize ?? 4,
  });
  const channel = harness.guild.add(
    fakeTextChannel({
      overwrites: squadTextOverwrites({ everyoneId: GUILD_ID, botId: BOT_ID, memberIds: [A, B] }),
    }),
  );
  const squad = seedSquad({ gameId: game.id, textChannelId: channel.id, name: 'Os Bravos' });
  seedMember(squad.id, A);
  seedMember(squad.id, B);
  return { ...harness, game, channel, squad };
}
type Scenario = ReturnType<typeof scenario>;

/** A marca "hoje 21h" (segunda, 14/09, em São Paulo) e devolve a jogatina. */
async function schedule(s: Scenario, when = 'hoje 21h', by = A) {
  const { session } = await s.service.scheduleSession(
    s.discordGuild,
    s.squad.id,
    by,
    when,
    'command',
  );
  return session;
}

const sessionRow = (id: number) => store.sessions.find((session) => session.id === id)!;
const messageById = (s: Scenario, id: string | null | undefined) =>
  s.channel.sent.find((message) => message.id === id);

function kindsOf(message: FakeMessage | undefined) {
  return (componentsOf(message) as { toJSON(): { components: { custom_id: string }[] } }[]).flatMap(
    (row) => row.toJSON().components.map((button) => parseSquadCustomId(button.custom_id)?.kind),
  );
}

describe('SquadService: CHAMAR GENTE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posta a jogatina no canal de busca com o histórico, uma vez só, e tira o botão', async () => {
    const s = scenario();
    const session = await schedule(s);
    expect(kindsOf(messageById(s, session.messageId))).toContain('call');

    const sent = await s.service.callForPlayers(s.discordGuild, session.id, B, 'event');

    const call = s.search.sent[0]!;
    expect(sent).toMatchObject({ channelId: s.search.id, messageId: call.id });
    expect(embedOf(call)?.title).toBe('> BORA JOGAR HELLDIVERS 2?');
    expect(embedOf(call)?.fields).toContainEqual({
      name: 'Histórico',
      value: 'Ainda não jogaram.',
    });
    expect(kindsOf(call)).toEqual(['enter']);
    expect(sessionRow(session.id)).toMatchObject({
      callChannelId: s.search.id,
      callMessageId: call.id,
    });
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'squad.session.call', actor: B, source: 'event' }),
    );

    const announce = messageById(s, session.messageId)!;
    expect(kindsOf(announce)).not.toContain('call');
    expect(embedOf(announce)?.fields?.find((field) => field.name === 'Chamada')?.value).toContain(
      `<#${s.search.id}>`,
    );

    await expect(
      s.service.callForPlayers(s.discordGuild, session.id, A, 'event'),
    ).rejects.toMatchObject({ code: 'CALL_EXISTS' });
    expect(s.search.sent).toHaveLength(1);
  });

  it('pelo guia chama a próxima jogatina com lugar; sem jogatina, pede BORA', async () => {
    const s = scenario({ groupSize: 4, partySize: 2 });
    await expect(
      s.service.callForNextSession(s.discordGuild, s.squad.id, A, 'event'),
    ).rejects.toMatchObject({ code: 'NO_SESSION' });

    const tonight = await schedule(s);
    await s.service.vote(s.discordGuild, tonight.id, B, true);
    const tomorrow = await schedule(s, 'amanhã 21h');

    await s.service.callForNextSession(s.discordGuild, s.squad.id, A, 'event');

    expect(sessionRow(tonight.id).calledAt).toBeNull();
    expect(sessionRow(tomorrow.id).callMessageId).toBe(s.search.sent[0]!.id);
  });

  it('com a party fechada em todas, o guia diz o motivo', async () => {
    const s = scenario({ groupSize: 4, partySize: 2 });
    const tonight = await schedule(s);
    await s.service.vote(s.discordGuild, tonight.id, B, true);

    await expect(
      s.service.callForNextSession(s.discordGuild, s.squad.id, A, 'event'),
    ).rejects.toMatchObject({ code: 'PARTY_FULL' });
    expect(s.search.sent).toEqual([]);
  });

  it('recusa quem não é do squad, squad completo e canal de busca sem configuração ou permissão', async () => {
    const s = scenario();
    const session = await schedule(s);
    await expect(
      s.service.callForPlayers(s.discordGuild, session.id, C, 'event'),
    ).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });

    s.setConfig({ searchChannelId: null });
    await expect(
      s.service.callForPlayers(s.discordGuild, session.id, A, 'event'),
    ).rejects.toMatchObject({ code: 'SEARCH_CHANNEL_UNAVAILABLE' });

    s.setConfig({ searchChannelId: s.search.id });
    s.search.permissionsFor.mockReturnValue(
      new PermissionsBitField(ALL_BUT_ADMIN & ~PermissionFlagsBits.SendMessages),
    );
    await expect(
      s.service.callForPlayers(s.discordGuild, session.id, A, 'event'),
    ).rejects.toMatchObject({ code: 'SEARCH_CHANNEL_UNAVAILABLE' });
    expect(sessionRow(session.id).calledAt).toBeNull();

    const full = scenario({ groupSize: 2 });
    const other = await schedule(full);
    await expect(
      full.service.callForPlayers(full.discordGuild, other.id, A, 'event'),
    ).rejects.toMatchObject({ code: 'SQUAD_FULL' });
    expect(kindsOf(messageById(full, other.messageId))).not.toContain('call');
  });

  it('mensagem que não sai desfaz a trava, e dá para chamar de novo', async () => {
    const s = scenario();
    const session = await schedule(s);
    s.search.send.mockRejectedValueOnce(Object.assign(new Error('500'), { code: 0 }));

    await expect(
      s.service.callForPlayers(s.discordGuild, session.id, A, 'event'),
    ).rejects.toMatchObject({ code: 'CALL_FAILED' });
    expect(sessionRow(session.id).calledAt).toBeNull();

    await s.service.callForPlayers(s.discordGuild, session.id, A, 'event');
    expect(sessionRow(session.id).callMessageId).toBe(s.search.sent[0]!.id);
  });
});

describe('SquadService: ENTRAR na chamada pública', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('vira pedido em votação ligado à jogatina, sem perfil; quem entra já vai nela', async () => {
    const s = scenario();
    const session = await schedule(s);
    await s.service.callForPlayers(s.discordGuild, session.id, A, 'event');

    const sent = await s.service.requestFromCall(s.discordGuild, C, session.id);

    expect(sent.squad.id).toBe(s.squad.id);
    expect(store.requests).toEqual([
      expect.objectContaining({ userId: C, status: 'pending', sessionId: session.id }),
    ]);
    const vote = s.channel.sent.find((message) => message.id === store.requests[0]!.messageId)!;
    expect(embedOf(vote)?.description).toContain('respondeu à chamada da jogatina');

    // Com dois membros, um voto a favor basta.
    const result = await s.service.voteJoinRequest(s.discordGuild, store.requests[0]!.id, A, true);

    expect(result.outcome).toBe('accepted');
    expect(store.members.map((member) => member.userId)).toContain(C);
    expect(sessionRow(session.id).goingIds).toEqual([A, C]);
  });

  it('recusa quem já é do squad, pedido repetido e squad que encheu', async () => {
    const s = scenario({ groupSize: 3 });
    const session = await schedule(s);
    await s.service.callForPlayers(s.discordGuild, session.id, A, 'event');

    await expect(s.service.requestFromCall(s.discordGuild, B, session.id)).rejects.toMatchObject({
      code: 'ALREADY_MEMBER',
    });
    await s.service.requestFromCall(s.discordGuild, C, session.id);
    await expect(s.service.requestFromCall(s.discordGuild, C, session.id)).rejects.toMatchObject({
      code: 'REQUEST_PENDING',
    });

    seedMember(s.squad.id, D);
    await expect(
      s.service.requestFromCall(s.discordGuild, '300000000000000005', session.id),
    ).rejects.toMatchObject({ code: 'SQUAD_FULL' });
  });

  it('a chamada sai do ar quando a jogatina começa, e ENTRAR atrasado avisa', async () => {
    const s = scenario();
    const session = await schedule(s);
    await s.service.callForPlayers(s.discordGuild, session.id, A, 'event');
    const call = s.search.sent[0]!;

    s.clock.now = session.startsAt.getTime();
    await s.service.startSession(s.discordGuild, sessionRow(session.id));

    expect(call.deleted).toBe(true);
    expect(sessionRow(session.id).callMessageId).toBeNull();
    await expect(s.service.requestFromCall(s.discordGuild, C, session.id)).rejects.toMatchObject({
      code: 'CALL_CLOSED',
    });
    expect(store.requests).toEqual([]);
  });

  it('cancelar a jogatina ou arquivar o squad também tira a chamada do ar', async () => {
    const s = scenario();
    const tonight = await schedule(s);
    const tomorrow = await schedule(s, 'amanhã 21h');
    await s.service.callForPlayers(s.discordGuild, tonight.id, A, 'event');
    await s.service.callForPlayers(s.discordGuild, tomorrow.id, A, 'event');
    const [first, second] = s.search.sent;

    await s.service.cancelSession(s.discordGuild, tonight.id, A, 'event');
    expect(first!.deleted).toBe(true);
    expect(second!.deleted).toBe(false);

    await s.service.archive(s.discordGuild, s.squad.id, { reason: 'teste' });
    expect(second!.deleted).toBe(true);
    expect(sessionRow(tomorrow.id).callMessageId).toBeNull();
  });

  it('chamada apagada por alguém não impede o início', async () => {
    const s = scenario();
    const session = await schedule(s);
    await s.service.callForPlayers(s.discordGuild, session.id, A, 'event');
    s.search.sent[0]!.deleted = true;

    s.clock.now = session.startsAt.getTime() + HOUR_MS;
    expect(await s.service.startSession(s.discordGuild, sessionRow(session.id))).not.toBeNull();
    expect(sessionRow(session.id).callMessageId).toBeNull();
    expect(sessionRow(session.id).startedAt).not.toBeNull();
  });
});
