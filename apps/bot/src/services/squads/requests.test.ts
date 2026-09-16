import { HOUR_MS, toBits } from '@goodbot/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BOT_ID, componentsOf, embedOf, fakeTextChannel, fakeThread } from './__fixtures__/discord';
import { A, B, C, createHarness, D, NOW } from './__fixtures__/harness';
import { squadTextOverwrites } from './overwrites';

import type { FakeMessage, FakeThread } from './__fixtures__/discord';
import type { SquadJoinRequest } from '@goodbot/db';
import type { TextChannel } from 'discord.js';

const fixtures = await vi.hoisted(async () => import('./__fixtures__/fake-db'));
vi.mock('@goodbot/db', () => fixtures.repositories);

const { store, seedGame, seedMember, seedProfile, seedSquad, GUILD_ID } = fixtures;

/** Alguém de fora do squad, sem perfil: é quem os membros convidam. */
const FRIEND = '300000000000000005';
const SATURDAY_NIGHT = toBits([{ day: 6, block: 2 }]);

/** Squad "Os Bravos" com `members` (A e B por padrão) e C procurando, no PC e no sábado à noite. */
function scenario(options: { size?: number; members?: string[] } = {}) {
  const harness = createHarness();
  const members = options.members ?? [A, B];
  const game = seedGame({ groupSize: options.size ?? 4, partySize: 2 });
  const channel = harness.guild.add(
    fakeTextChannel({
      overwrites: squadTextOverwrites({ everyoneId: GUILD_ID, botId: BOT_ID, memberIds: members }),
    }),
  );
  const squad = seedSquad({ gameId: game.id, textChannelId: channel.id, name: 'Os Bravos' });
  for (const userId of members) {
    seedMember(squad.id, userId);
    seedProfile({ userId, gameId: game.id, availability: SATURDAY_NIGHT, status: 'in_squad' });
  }
  seedProfile({ userId: C, gameId: game.id, availability: SATURDAY_NIGHT });

  /** O convite do matcher, já na thread. */
  async function invite(userId = C): Promise<{ request: SquadJoinRequest; thread: FakeThread }> {
    const result = await harness.parts.requests.invite(
      harness.discordGuild,
      harness.search as unknown as TextChannel,
      squad,
      userId,
      { invitedBy: null },
    );
    if (result.outcome !== 'sent') throw new Error(`convite não saiu: ${result.outcome}`);
    return { request: result.request, thread: harness.search.threads.created.at(-1)! };
  }

  /** C aceitou o convite: a votação está no canal do squad. */
  async function voting(): Promise<{
    request: SquadJoinRequest;
    thread: FakeThread;
    vote: FakeMessage;
  }> {
    const invited = await invite();
    await harness.service.answerInvite(harness.discordGuild, invited.request.id, C, true);
    return { ...invited, vote: voteMessage(channel)! };
  }

  return { ...harness, game, channel, squad, invite, voting };
}

const requestRow = () => store.requests[0]!;
const memberIds = () => store.members.map((member) => member.userId);
const labelsOf = (message: FakeMessage | undefined) =>
  (componentsOf(message) as { toJSON(): { components: { label?: string }[] } }[]).flatMap((row) =>
    row.toJSON().components.map((component) => component.label),
  );
const fieldOf = (message: FakeMessage | undefined, name: string) =>
  embedOf(message)?.fields?.find((field) => field.name === name)?.value;
const voteMessage = (channel: { sent: FakeMessage[] }) =>
  channel.sent.find((message) => embedOf(message)?.title === '> PEDIDO PARA ENTRAR');

describe('SquadService: convite para squad (fase 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('abre uma thread privada só com o candidato, com o squad à vista e ENTRAR / PASSO', async () => {
    const s = scenario();

    const { request, thread } = await s.invite();

    expect(thread.members.add.mock.calls.map(([id]) => id)).toEqual([C]);
    const message = thread.sent[0]!;
    expect(message.payload.content).toBe(`<@${C}>`);
    expect(message.payload.allowedMentions).toEqual({ users: [C] });
    expect(labelsOf(message)).toEqual(['ENTRAR', 'PASSO']);
    expect(embedOf(message)?.description).toContain('**Os Bravos**');
    expect(fieldOf(message, 'Membros')).toBe(`<@${A}>, <@${B}>`);
    expect(request).toMatchObject({
      status: 'invited',
      invitedBy: null,
      threadId: thread.id,
      inviteMessageId: message.id,
    });
    expect(request.expiresAt.getTime()).toBe(NOW + 72 * HOUR_MS);
    // Nada chega ao squad antes de o candidato aceitar.
    expect(s.channel.sent).toEqual([]);
  });

  it('um convite aberto por pessoa e squad', async () => {
    const s = scenario();
    await s.invite();

    const again = await s.parts.requests.invite(
      s.discordGuild,
      s.search as unknown as TextChannel,
      s.squad,
      C,
      { invitedBy: null },
    );

    expect(again).toEqual({ outcome: 'exists' });
    expect(s.search.threads.create).toHaveBeenCalledTimes(1);
  });

  it('thread que falha no meio não deixa convite aberto', async () => {
    const s = scenario();
    s.search.threads.create.mockImplementationOnce(async () => {
      const thread = s.guild.add(fakeThread());
      thread.members.add.mockRejectedValueOnce(new Error('Unknown Member'));
      s.search.threads.created.push(thread);
      return thread;
    });

    const result = await s.parts.requests.invite(
      s.discordGuild,
      s.search as unknown as TextChannel,
      s.squad,
      C,
      { invitedBy: null },
    );

    expect(result).toEqual({ outcome: 'failed' });
    expect(requestRow().status).toBe('expired');
    expect(s.search.threads.created[0]!.delete).toHaveBeenCalled();
  });

  it('PASSO fecha o convite e a thread, sem chamar o squad', async () => {
    const s = scenario();
    const { request, thread } = await s.invite();

    const answer = await s.service.answerInvite(s.discordGuild, request.id, C, false);

    expect(answer).toEqual({ outcome: 'passed' });
    expect(requestRow()).toMatchObject({ status: 'declined', decidedBy: C });
    expect(componentsOf(thread.sent[0])).toEqual([]);
    expect(embedOf(thread.sent[0])?.description).toContain('Você passou');
    expect(thread).toMatchObject({ locked: true, archived: true });
    expect(s.channel.sent).toEqual([]);
    expect(await s.service.answerInvite(s.discordGuild, request.id, C, true)).toEqual({
      outcome: 'already',
      status: 'declined',
    });
  });

  it('só o candidato responde o convite', async () => {
    const s = scenario();
    const { request } = await s.invite();

    await expect(s.service.answerInvite(s.discordGuild, request.id, A, true)).rejects.toMatchObject(
      { code: 'NOT_INVITED' },
    );
    expect(requestRow().status).toBe('invited');
  });

  it('ENTRAR leva o pedido à votação no canal do squad, chamando os membros', async () => {
    const s = scenario();
    const { request, thread } = await s.invite();
    s.clock.now = NOW + 10 * HOUR_MS;

    const answer = await s.service.answerInvite(s.discordGuild, request.id, C, true);

    expect(answer).toMatchObject({ outcome: 'voting' });
    expect(requestRow().status).toBe('pending');
    // O prazo recomeça para a votação.
    expect(requestRow().expiresAt.getTime()).toBe(NOW + 82 * HOUR_MS);
    const vote = voteMessage(s.channel)!;
    expect(requestRow().messageId).toBe(vote.id);
    expect(vote.payload.content).toBe(`<@${A}> <@${B}>`);
    expect(vote.payload.allowedMentions).toEqual({ users: [A, B] });
    expect(labelsOf(vote)).toEqual(['A FAVOR', 'CONTRA']);
    expect(fieldOf(vote, 'Plataforma')).toBe('PC');
    expect(fieldOf(vote, 'Joga com vocês em')).toContain('Sábado');
    expect(fieldOf(vote, 'Votos')).toBe('0 a favor, 0 contra, 2 sem votar');
    // O convite perde os botões e a thread tranca, mas fica aberta para o aviso.
    expect(componentsOf(thread.sent[0])).toEqual([]);
    expect(thread).toMatchObject({ locked: true, archived: false });
  });

  it('convite vencido não entra, e o job o fecha em silêncio', async () => {
    const s = scenario();
    const { request, thread } = await s.invite();
    s.clock.now = NOW + 73 * HOUR_MS;

    expect(await s.service.expireRequests(GUILD_ID)).toBe(1);

    expect(requestRow().status).toBe('expired');
    expect(embedOf(thread.sent[0])?.description).toContain('expirou');
    expect(thread.sent).toHaveLength(1);
    expect(thread.archived).toBe(true);
    expect(await s.service.answerInvite(s.discordGuild, request.id, C, true)).toEqual({
      outcome: 'already',
      status: 'expired',
    });
  });
});

describe('SquadService: votação do squad (fase 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('com dois membros, um voto a favor já põe a pessoa no squad', async () => {
    const s = scenario();
    const { request, thread, vote } = await s.voting();

    const result = await s.service.voteJoinRequest(s.discordGuild, request.id, A, true);

    expect(result).toMatchObject({ outcome: 'accepted' });
    expect(requestRow()).toMatchObject({ status: 'accepted', decidedBy: A, acceptedIds: [A] });
    expect(memberIds()).toEqual([A, B, C]);
    expect(store.profiles.find((profile) => profile.userId === C)?.status).toBe('in_squad');
    expect(s.channel.permissionOverwrites.cache.has(C)).toBe(true);
    const joined = s.channel.sent.find((message) => embedOf(message)?.title === '> CHEGOU REFORÇO');
    expect(joined?.payload.content).toBe(`<@${C}>`);
    expect(componentsOf(vote)).toEqual([]);
    expect(embedOf(vote)?.description).toContain('entrou no squad');
    expect(embedOf(thread.sent[0])?.description).toContain('Você entrou');
    expect(thread.archived).toBe(true);
  });

  it('maioria contra recusa e avisa o candidato na thread', async () => {
    const s = scenario({ members: [A, B, D] });
    const { request, thread, vote } = await s.voting();

    expect(await s.service.voteJoinRequest(s.discordGuild, request.id, A, false)).toEqual({
      outcome: 'recorded',
      inFavor: false,
    });
    expect(fieldOf(vote, 'Votos')).toBe('0 a favor, 1 contra, 2 sem votar');
    expect(vote.payload.allowedMentions).toEqual({ users: [] });

    expect(await s.service.voteJoinRequest(s.discordGuild, request.id, B, false)).toEqual({
      outcome: 'declined',
    });
    expect(requestRow()).toMatchObject({ status: 'declined', decidedBy: B });
    expect(memberIds()).toEqual([A, B, D]);
    expect(componentsOf(vote)).toEqual([]);
    const notice = thread.sent.at(-1)!;
    expect(notice.payload.content).toContain(`<@${C}> não rolou desta vez`);
    expect(notice.payload.allowedMentions).toEqual({ users: [C] });
    expect(thread.archived).toBe(true);
  });

  it('empate com todos votando entra', async () => {
    const s = scenario({ members: [A, B] });
    const { request } = await s.voting();

    await s.service.voteJoinRequest(s.discordGuild, request.id, B, false);
    const result = await s.service.voteJoinRequest(s.discordGuild, request.id, A, true);

    expect(result).toMatchObject({ outcome: 'accepted' });
    expect(memberIds()).toContain(C);
  });

  it('votar de novo troca de lado, e repetir o voto não muda nada', async () => {
    const s = scenario({ members: [A, B, D] });
    const { request, vote } = await s.voting();

    await s.service.voteJoinRequest(s.discordGuild, request.id, A, false);
    expect(await s.service.voteJoinRequest(s.discordGuild, request.id, A, false)).toEqual({
      outcome: 'unchanged',
    });
    expect(await s.service.voteJoinRequest(s.discordGuild, request.id, A, true)).toEqual({
      outcome: 'recorded',
      inFavor: true,
    });

    expect(requestRow()).toMatchObject({ status: 'pending', acceptedIds: [A], declinedIds: [] });
    expect(fieldOf(vote, 'Votos')).toBe('1 a favor, 0 contra, 2 sem votar');
  });

  it('só membro vota', async () => {
    const s = scenario();
    const { request } = await s.voting();

    await expect(
      s.service.voteJoinRequest(s.discordGuild, request.id, C, true),
    ).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
  });

  it('votação vencida entra com um voto a favor', async () => {
    const s = scenario({ members: [A, B, D] });
    const { request } = await s.voting();
    await s.service.voteJoinRequest(s.discordGuild, request.id, A, true);
    s.clock.now = NOW + 73 * HOUR_MS;

    expect(await s.service.expireRequests(GUILD_ID)).toBe(1);

    expect(requestRow()).toMatchObject({ status: 'accepted', decidedBy: null });
    expect(memberIds()).toEqual([A, B, D, C]);
  });

  it('votação vencida sem nenhum voto a favor acaba sem entrar e avisa o candidato', async () => {
    const s = scenario({ members: [A, B, D] });
    const { request, thread, vote } = await s.voting();
    await s.service.voteJoinRequest(s.discordGuild, request.id, A, false);
    s.clock.now = NOW + 73 * HOUR_MS;

    expect(await s.service.expireRequests(GUILD_ID)).toBe(1);

    expect(requestRow().status).toBe('expired');
    expect(memberIds()).toEqual([A, B, D]);
    expect(embedOf(vote)?.description).toContain('acabou no prazo');
    expect(thread.sent.at(-1)?.payload.content).toContain(`<@${C}> não rolou`);
  });

  it('quem sai do squad deixa de votar, e a votação reconta na hora', async () => {
    const s = scenario({ members: [A, B, D] });
    const { request } = await s.voting();
    await s.service.voteJoinRequest(s.discordGuild, request.id, A, true);
    await s.service.voteJoinRequest(s.discordGuild, request.id, B, false);
    expect(requestRow().status).toBe('pending');

    await s.service.removeMember(s.discordGuild, s.squad.id, D, null);

    // Um a favor e um contra entre os dois que ficaram: empate entra.
    expect(requestRow().status).toBe('accepted');
    expect(memberIds()).toEqual([A, B, C]);
  });

  it('squad que encheu durante a votação encerra o pedido em vez de pôr alguém a mais', async () => {
    const s = scenario({ size: 3 });
    const { request, thread } = await s.voting();
    seedMember(s.squad.id, D);

    await s.service.voteJoinRequest(s.discordGuild, request.id, A, true);
    const result = await s.service.voteJoinRequest(s.discordGuild, request.id, B, true);

    expect(result).toEqual({ outcome: 'closed' });
    expect(requestRow().status).toBe('expired');
    expect(memberIds()).toEqual([A, B, D]);
    expect(thread.sent.at(-1)?.payload.content).toContain('não está mais disponível');
  });

  it('pedido já decidido responde o status, sem votar de novo', async () => {
    const s = scenario();
    const { request } = await s.voting();
    await s.service.voteJoinRequest(s.discordGuild, request.id, A, true);

    const again = await s.service.voteJoinRequest(s.discordGuild, request.id, B, false);

    expect(again).toEqual({ outcome: 'already', status: 'accepted' });
    expect(requestRow().declinedIds).toEqual([]);
  });

  it('arquivar o squad encerra convite e votação abertos', async () => {
    const s = scenario();
    const { thread } = await s.voting();
    seedProfile({ userId: D, gameId: s.game.id, availability: SATURDAY_NIGHT });
    await s.invite(D);

    await s.service.archive(s.discordGuild, s.squad.id, { reason: null });

    expect(store.requests.map((request) => request.status)).toEqual(['expired', 'expired']);
    expect(thread.archived).toBe(true);
    expect(thread.sent.at(-1)?.payload.content).toContain(`<@${C}>`);
  });
});

describe('SquadService: convite de membro', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('entra sem votação e ganha o perfil pausado que faltava', async () => {
    const s = scenario();

    const sent = await s.service.inviteToSquad(
      s.discordGuild,
      s.squad.id,
      A,
      { id: FRIEND, bot: false },
      'command',
    );

    expect(sent.request).toMatchObject({ status: 'invited', invitedBy: A, userId: FRIEND });
    const thread = s.search.threads.created[0]!;
    expect(embedOf(thread.sent[0])?.description).toContain(`<@${A}> chamou você`);
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'squad.member.invite', actor: A }),
    );

    const answer = await s.service.answerInvite(s.discordGuild, sent.request.id, FRIEND, true);

    expect(answer).toMatchObject({ outcome: 'joined' });
    expect(memberIds()).toEqual([A, B, FRIEND]);
    expect(store.profiles.find((profile) => profile.userId === FRIEND)).toMatchObject({
      status: 'in_squad',
      availability: 0,
    });
    expect(voteMessage(s.channel)).toBeUndefined();
    expect(requestRow()).toMatchObject({ status: 'accepted', decidedBy: FRIEND });
    expect(thread.archived).toBe(true);
  });

  it('recusa bot, quem já está, quem não é do squad e squad completo', async () => {
    const s = scenario({ size: 2 });
    const invite = (inviterId: string, target: { id: string; bot: boolean }) =>
      s.service.inviteToSquad(s.discordGuild, s.squad.id, inviterId, target, 'command');

    await expect(invite(A, { id: FRIEND, bot: true })).rejects.toMatchObject({
      code: 'INVITE_BOT',
    });
    await expect(invite(A, { id: B, bot: false })).rejects.toMatchObject({
      code: 'ALREADY_MEMBER',
    });
    await expect(invite(C, { id: FRIEND, bot: false })).rejects.toMatchObject({
      code: 'NOT_A_MEMBER',
    });
    await expect(invite(A, { id: FRIEND, bot: false })).rejects.toMatchObject({
      code: 'SQUAD_FULL',
    });
    expect(store.requests).toEqual([]);
  });

  it('respeita o "não" recente da pessoa e o convite que já está aberto', async () => {
    const s = scenario();
    const invite = () =>
      s.service.inviteToSquad(s.discordGuild, s.squad.id, A, { id: FRIEND, bot: false }, 'event');

    const first = await invite();
    await expect(invite()).rejects.toMatchObject({ code: 'REQUEST_PENDING' });

    await s.service.answerInvite(s.discordGuild, first.request.id, FRIEND, false);
    await expect(invite()).rejects.toMatchObject({ code: 'INVITE_COOLDOWN' });

    // Passada a pausa, pode chamar de novo.
    s.clock.now = NOW + 15 * 24 * HOUR_MS;
    await expect(invite()).resolves.toMatchObject({ squad: { id: s.squad.id } });
  });

  it('sem canal de busca utilizável, explica em vez de convidar', async () => {
    const s = scenario();
    s.setConfig({ searchChannelId: null });

    await expect(
      s.service.inviteToSquad(s.discordGuild, s.squad.id, A, { id: FRIEND, bot: false }, 'event'),
    ).rejects.toMatchObject({ code: 'SEARCH_CHANNEL_UNAVAILABLE' });
    expect(store.requests).toEqual([]);
  });
});
