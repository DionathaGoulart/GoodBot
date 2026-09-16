import { toBits } from '@goodbot/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { embedOf, fakeTextChannel } from './__fixtures__/discord';
import { A, B, C, createHarness, D } from './__fixtures__/harness';
import { log } from './context';

import type { Harness } from './__fixtures__/harness';
import type { SquadProfile } from '@goodbot/db';
import type { SquadStatus } from '@goodbot/shared';
import type { APIEmbed, EmbedBuilder } from 'discord.js';

const fixtures = await vi.hoisted(async () => import('./__fixtures__/fake-db'));
vi.mock('@goodbot/db', () => fixtures.repositories);

const { store, impl, seedGame, seedMember, seedProfile, seedProposal, seedSquad, GUILD_ID } =
  fixtures;

const ADMIN = '300000000000000010';
const REASON = 'Não aparece nas sessões há três semanas.';
const SATURDAY_NIGHT = toBits([{ day: 6, block: 2 }]);

function scenario() {
  const harness = createHarness();
  const game = seedGame({ squadSize: 3 });
  const profile = (userId: string, extra: Partial<SquadProfile> = {}) =>
    seedProfile({ userId, gameId: game.id, availability: SATURDAY_NIGHT, ...extra });
  const squad = (members: string[], status: SquadStatus = 'open') => {
    const channel = harness.guild.add(fakeTextChannel({ name: 'squad-teste' }));
    const row = seedSquad({ gameId: game.id, textChannelId: channel.id, status });
    for (const userId of members) seedMember(row.id, userId);
    return { squad: row, channel };
  };
  const status = (userId: string, next: 'searching' | 'paused') =>
    harness.service.setProfileStatusAsAdmin(harness.discordGuild, game.id, userId, {
      actorId: ADMIN,
      status: next,
      reason: REASON,
    });
  return { ...harness, game, profile, squad, status };
}

const profileOf = (userId: string) => store.profiles.find((row) => row.userId === userId);

function dmEmbed(s: Harness, userId: string, index = 0): APIEmbed | undefined {
  const embeds = s.users.dmsOf(userId)[index]?.embeds as EmbedBuilder[] | undefined;
  return embeds?.[0]?.toJSON();
}

/** A DM com o motivo do admin, o jogo e o próximo passo. */
function expectReasonDm(s: Harness, userId: string, title: string, nextStep: string) {
  const embed = dmEmbed(s, userId);
  expect(embed?.title).toBe(title);
  expect(embed?.description).toContain('**Servidor Teste**');
  expect(embed?.description).toContain('**Helldivers 2**');
  expect(embed?.description).toContain(nextStep);
  expect(embed?.fields).toEqual([expect.objectContaining({ value: REASON })]);
}

describe('SquadService: admin muda o status de outra pessoa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pausar grava, audita com o motivo e avisa por DM', async () => {
    const s = scenario();
    s.profile(A);

    const result = await s.status(A, 'paused');

    expect(result).toMatchObject({ profile: { status: 'paused' }, match: null, notified: true });
    expect(profileOf(A)?.status).toBe('paused');
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'squad.profile.status',
        source: 'dashboard',
        actor: ADMIN,
        target: { type: 'member', id: A },
        reason: REASON,
        before: { gameId: s.game.id, status: 'searching' },
        after: { gameId: s.game.id, status: 'paused' },
      }),
    );
    expectReasonDm(s, A, '> SUA BUSCA DE SQUAD FOI PAUSADA', '/squad status procurando');
  });

  it('retomar roda o match e abre proposta com quem combina', async () => {
    const s = scenario();
    s.profile(A, { status: 'paused' });
    s.profile(B);

    const result = await s.status(A, 'searching');

    expect(result.match).toEqual({ proposals: 1, joinRequests: 0 });
    expect(store.proposals[0]?.userIds).toEqual([A, B]);
    expectReasonDm(s, A, '> SUA BUSCA DE SQUAD VOLTOU', '/squad status pausado');
  });

  it('membro de squad deste jogo, status igual e perfil sem grade são recusados, sem DM', async () => {
    const s = scenario();
    s.profile(A, { status: 'in_squad' });
    s.squad([A]);
    s.profile(B);
    s.profile(C, { status: 'paused', availability: 0 });

    await expect(s.status(A, 'paused')).rejects.toMatchObject({ code: 'PROFILE_IN_SQUAD' });
    await expect(s.status(B, 'searching')).rejects.toMatchObject({ code: 'STATUS_UNCHANGED' });
    await expect(s.status(C, 'searching')).rejects.toMatchObject({ code: 'NO_AVAILABILITY' });

    expect(s.users.fetch).not.toHaveBeenCalled();
    expect(s.audit.record).not.toHaveBeenCalled();
    expect(profileOf(A)?.status).toBe('in_squad');
  });

  it('in_squad atrasado, sem squad vivo, pode ser pausado e o status se corrige', async () => {
    const s = scenario();
    s.profile(A, { status: 'in_squad' });

    await s.status(A, 'paused');

    expect(profileOf(A)?.status).toBe('paused');
  });
});

describe('SquadService: admin edita respostas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const edit = (s: ReturnType<typeof scenario>, userId: string, answers: unknown) =>
    s.service.editProfileAnswersAsAdmin(s.discordGuild, s.game.id, userId, {
      actorId: ADMIN,
      answers: answers as Record<string, string>,
      reason: REASON,
    });

  it('salva contra os campos atuais, audita antes e depois, avisa e não roda o match', async () => {
    const s = scenario();
    s.profile(A, { answers: { platform: 'PC' } });
    s.profile(B, { answers: { platform: 'PS5' } });

    const result = await edit(s, A, { platform: 'PS5' });

    expect(result).toMatchObject({ profile: { answers: { platform: 'PS5' } }, notified: true });
    expect(s.search.threads.create).not.toHaveBeenCalled();
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'squad.profile.answers',
        reason: REASON,
        before: { gameId: s.game.id, answers: { platform: 'PC' } },
        after: { gameId: s.game.id, answers: { platform: 'PS5' } },
      }),
    );
    expectReasonDm(s, A, '> SUAS RESPOSTAS DE SQUAD MUDARAM', '/squad perfil');
  });

  it('chave desconhecida e obrigatório vazio são recusados; perfil inexistente não é criado', async () => {
    const s = scenario();
    s.profile(A);

    await expect(edit(s, A, { platform: 'PC', extra: 'x' })).rejects.toMatchObject({
      code: 'INVALID_ANSWERS',
    });
    await expect(edit(s, A, {})).rejects.toMatchObject({
      code: 'INVALID_ANSWERS',
      message: 'Plataforma: Campo obrigatório.',
    });
    await expect(edit(s, D, { platform: 'PC' })).rejects.toMatchObject({
      code: 'PROFILE_NOT_FOUND',
    });

    expect(profileOf(D)).toBeUndefined();
    expect(profileOf(A)?.answers).toEqual({ platform: 'PC' });
    expect(s.users.fetch).not.toHaveBeenCalled();
  });
});

describe('SquadService: admin apaga perfil', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const remove = (s: ReturnType<typeof scenario>, userId: string) =>
    s.service.deleteProfileAsAdmin(s.discordGuild, s.game.id, userId, {
      actorId: ADMIN,
      reason: REASON,
    });

  it('recusa quem está em squad, em proposta aberta ou com pedido pendente; quem passou pode', async () => {
    const s = scenario();
    s.profile(A, { status: 'in_squad' });
    const { squad } = s.squad([A]);
    s.profile(B);
    s.profile(C);
    seedProposal({ gameId: s.game.id, userIds: [B, C], declinedIds: [C], threadId: '1' });
    s.profile(D);
    await impl.createSquadJoinRequest(null, { guildId: GUILD_ID, squadId: squad.id, userId: D });

    await expect(remove(s, A)).rejects.toMatchObject({ code: 'PROFILE_IN_SQUAD' });
    await expect(remove(s, B)).rejects.toMatchObject({ code: 'PROFILE_IN_PROPOSAL' });
    await expect(remove(s, D)).rejects.toMatchObject({ code: 'PROFILE_HAS_JOIN_REQUEST' });
    expect(s.users.fetch).not.toHaveBeenCalled();

    expect((await remove(s, C)).deleted.userId).toBe(C);
    expect(profileOf(C)).toBeUndefined();
  });

  it('apagar tira a pessoa da busca, audita o perfil inteiro e avisa', async () => {
    const s = scenario();
    s.profile(A);
    s.profile(B);

    const result = await remove(s, A);

    expect(result).toMatchObject({ deleted: { userId: A }, notified: true });
    expect(profileOf(A)).toBeUndefined();
    expect(await s.service.runMatch(GUILD_ID, s.game.id)).toEqual({
      proposals: 0,
      joinRequests: 0,
    });
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'squad.profile.delete',
        reason: REASON,
        before: expect.objectContaining({ userId: A, gameId: s.game.id }),
      }),
    );
    expectReasonDm(s, A, '> SEU PERFIL DE SQUAD FOI APAGADO', '/squad perfil');
    await expect(remove(s, A)).rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND' });
  });
});

describe('SquadService: admin tira alguém do squad', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('avisa o canal sem o motivo e manda a DM citando o squad', async () => {
    const s = scenario();
    s.profile(A, { status: 'in_squad' });
    s.profile(B, { status: 'in_squad' });
    const { squad, channel } = s.squad([A, B], 'full');

    const result = await s.service.removeMemberAsAdmin(s.discordGuild, squad.id, B, {
      actorId: ADMIN,
      reason: REASON,
    });

    expect(result).toMatchObject({ archived: false, profileStatus: 'paused', notified: true });
    // Depois do aviso vem o guia, publicado porque o squad ainda não tinha.
    const left = channel.sent.find((message) => embedOf(message)?.title === '> ALGUÉM SAIU');
    const notice = embedOf(left)?.description ?? '';
    expect(notice).toContain(`A staff tirou <@${B}>`);
    expect(notice).not.toContain(REASON);
    expect(notice).not.toContain(ADMIN);
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'squad.member.leave',
        source: 'dashboard',
        actor: ADMIN,
        reason: REASON,
      }),
    );
    expectReasonDm(s, B, '> VOCÊ SAIU DE UM SQUAD', '/squad status procurando');
    expect(dmEmbed(s, B)?.description).toContain('**Squad Teste**');
  });

  it('quem não é membro, ou squad arquivado, é recusado sem DM', async () => {
    const s = scenario();
    const { squad } = s.squad([A]);
    const archived = s.squad([B], 'archived').squad;
    const input = { actorId: ADMIN, reason: REASON };

    await expect(
      s.service.removeMemberAsAdmin(s.discordGuild, squad.id, C, input),
    ).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
    await expect(
      s.service.removeMemberAsAdmin(s.discordGuild, archived.id, B, input),
    ).rejects.toMatchObject({ code: 'SQUAD_ARCHIVED' });
    expect(s.users.fetch).not.toHaveBeenCalled();
  });
});

describe('SquadService: DM de admin que não chega', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DM fechada: a ação vale, notified é false e o log não leva o motivo nem o texto', async () => {
    const s = scenario();
    s.profile(A);
    s.users.closeDms(A);
    const warn = vi.spyOn(log, 'warn');

    const result = await s.status(A, 'paused');

    expect(result.notified).toBe(false);
    expect(profileOf(A)?.status).toBe('paused');
    expect(warn).toHaveBeenCalledWith(
      { guildId: GUILD_ID, action: 'paused', userId: A, code: 50007 },
      'não foi possível avisar a pessoa por DM',
    );
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(REASON);
    expect(logged).not.toContain('pausou');
    warn.mockRestore();
  });

  it('usuário que o Discord não acha dá o mesmo resultado', async () => {
    const s = scenario();
    s.profile(A);
    s.users.unknownUser(A);

    const result = await s.service.deleteProfileAsAdmin(s.discordGuild, s.game.id, A, {
      actorId: ADMIN,
      reason: REASON,
    });

    expect(result.notified).toBe(false);
    expect(profileOf(A)).toBeUndefined();
  });
});
