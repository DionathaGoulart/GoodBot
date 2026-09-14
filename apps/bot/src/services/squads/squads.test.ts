import { toBits } from '@goodbot/shared';
import { PermissionFlagsBits } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BOT_ID, embedOf, fakeTextChannel } from './__fixtures__/discord';
import { A, B, C, createHarness } from './__fixtures__/harness';
import { LEAVE_NOTICE, RENAME_LATER_NOTE } from './embeds';
import { squadTextOverwrites } from './overwrites';

import type { SquadStatus } from '@goodbot/shared';

const fixtures = await vi.hoisted(async () => import('./__fixtures__/fake-db'));
vi.mock('@goodbot/db', () => fixtures.repositories);

const { store, seedGame, seedMember, seedProfile, seedSquad, GUILD_ID } = fixtures;

function scenario(options: { size: number; members: string[]; status?: SquadStatus }) {
  const harness = createHarness();
  const game = seedGame({ squadSize: options.size });
  const channel = harness.guild.add(
    fakeTextChannel({
      name: 'squad-teste',
      overwrites: squadTextOverwrites({
        everyoneId: GUILD_ID,
        botId: BOT_ID,
        memberIds: options.members,
      }),
    }),
  );
  const squad = seedSquad({
    gameId: game.id,
    textChannelId: channel.id,
    status: options.status ?? 'open',
  });
  for (const userId of options.members) {
    seedMember(squad.id, userId);
    seedProfile({
      userId,
      gameId: game.id,
      availability: toBits([{ day: 6, block: 2 }]),
      status: 'in_squad',
    });
  }
  return { ...harness, game, channel, squad };
}

const row = (id: string) => store.squads.find((squad) => squad.id === id)!;

describe('SquadService: ciclo de vida', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sair de um squad cheio reabre a vaga e pausa o perfil', async () => {
    const s = scenario({ size: 2, members: [A, B], status: 'full' });

    const result = await s.service.removeMember(s.discordGuild, s.squad.id, B, null);

    expect(row(s.squad.id).status).toBe('open');
    expect(s.channel.permissionOverwrites.cache.has(B)).toBe(false);
    expect(embedOf(s.channel.sent[0])?.title).toBe('> ALGUÉM SAIU');
    expect(result).toMatchObject({
      archived: false,
      profileStatus: 'paused',
      notice: LEAVE_NOTICE,
    });
    expect(store.profiles.find((profile) => profile.userId === B)?.status).toBe('paused');
  });

  it('admin tira alguém com o módulo desligado: aviso da staff, vaga reaberta e perfil pausado', async () => {
    const s = scenario({ size: 2, members: [A, B], status: 'full' });
    s.setConfig({ enabled: false });

    const result = await s.service.removeMember(s.discordGuild, s.squad.id, B, 'motivo privado', {
      source: 'dashboard',
      actorId: C,
      force: true,
      removedBy: C,
    });

    expect(row(s.squad.id).status).toBe('open');
    expect(result).toMatchObject({ archived: false, profileStatus: 'paused' });
    const notice = embedOf(s.channel.sent[0])?.description ?? '';
    expect(notice).toContain(`A staff tirou <@${B}> do squad pelo painel.`);
    expect(notice).not.toContain(C);
    expect(notice).not.toContain('motivo privado');
  });

  it('sem force, o módulo desligado recusa a saída', async () => {
    const s = scenario({ size: 2, members: [A, B] });
    s.setConfig({ enabled: false });

    await expect(
      s.service.removeMember(s.discordGuild, s.squad.id, B, null),
    ).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
    expect(store.members).toHaveLength(2);
  });

  it('admin tirando o último membro arquiva o squad', async () => {
    const s = scenario({ size: 3, members: [A] });
    s.setConfig({ enabled: false });

    const result = await s.service.removeMember(s.discordGuild, s.squad.id, A, 'limpeza', {
      source: 'dashboard',
      actorId: C,
      force: true,
      removedBy: C,
    });

    expect(result.archived).toBe(true);
    expect(row(s.squad.id).status).toBe('archived');
  });

  it('o último a sair arquiva o squad e tranca o canal', async () => {
    const s = scenario({ size: 3, members: [A] });

    const result = await s.service.removeMember(s.discordGuild, s.squad.id, A, null);

    expect(result.archived).toBe(true);
    expect(row(s.squad.id)).toMatchObject({ status: 'archived' });
    expect(row(s.squad.id).archivedAt).not.toBeNull();
    expect(embedOf(s.channel.sent.at(-1))?.title).toBe('> SQUAD ARQUIVADO');
    expect(store.profiles[0]?.status).toBe('paused');
  });

  it('arquivar deixa os membros lendo sem escrever', async () => {
    const s = scenario({ size: 3, members: [A, B] });

    await s.service.archive(s.discordGuild, s.squad.id, { reason: 'teste', actorId: C });

    const member = s.channel.permissionOverwrites.cache.get(A)!;
    expect(member.allow.bitfield & PermissionFlagsBits.ViewChannel).toBe(
      PermissionFlagsBits.ViewChannel,
    );
    expect(member.allow.bitfield & PermissionFlagsBits.SendMessages).toBe(0n);
    expect(member.deny.bitfield & PermissionFlagsBits.SendMessages).toBe(
      PermissionFlagsBits.SendMessages,
    );
    expect(store.profiles.every((profile) => profile.status === 'paused')).toBe(true);
    expect(await s.service.archive(s.discordGuild, s.squad.id, { reason: 'de novo' })).toBeNull();
  });

  it('quem não é membro não renomeia', async () => {
    const s = scenario({ size: 3, members: [A] });

    await expect(
      s.service.rename(s.discordGuild, s.squad.id, 'Os Bravos', C),
    ).rejects.toMatchObject({
      code: 'NOT_A_MEMBER',
    });
    expect(row(s.squad.id).name).toBe('Squad Teste');
  });

  it('renomear muda o banco e o canal', async () => {
    const s = scenario({ size: 3, members: [A] });

    const result = await s.service.rename(s.discordGuild, s.squad.id, 'Os Bravos', A);

    expect(result).toMatchObject({ channelRenamed: true, note: null });
    expect(row(s.squad.id).name).toBe('Os Bravos');
    expect(s.channel.name).toBe('squad-os-bravos');
  });

  it('canal que não aceita o nome agora mantém o banco e avisa', async () => {
    const s = scenario({ size: 3, members: [A] });
    s.channel.setName.mockRejectedValueOnce(new Error('rate limited'));

    const result = await s.service.rename(s.discordGuild, s.squad.id, 'Os Bravos', A);

    expect(result).toMatchObject({ channelRenamed: false, note: RENAME_LATER_NOTE });
    expect(row(s.squad.id).name).toBe('Os Bravos');
  });

  it('"Ainda jogamos" zera o aviso de inatividade', async () => {
    const s = scenario({ size: 3, members: [A] });
    store.squads[0]!.warnedAt = new Date(0);

    await s.service.keepAlive(s.discordGuild, s.squad.id, A);

    expect(row(s.squad.id).warnedAt).toBeNull();
    expect(row(s.squad.id).lastConfirmedAt).not.toBeNull();
  });
});
