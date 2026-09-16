import { HOUR_MS, toBits } from '@goodbot/shared';
import { PermissionFlagsBits } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { componentsOf, embedOf, fakeTextChannel, fakeThread } from './__fixtures__/discord';
import { A, B, C, createHarness, D, NOW } from './__fixtures__/harness';
import { NO_VOICE_NOTE } from './embeds';
import { SQUAD_MEMBER_TEXT_BITS } from './overwrites';

import type { FakeTextChannel } from './__fixtures__/discord';
import type { SquadsConfig } from '@goodbot/shared';

const fixtures = await vi.hoisted(async () => import('./__fixtures__/fake-db'));
vi.mock('@goodbot/db', () => fixtures.repositories);

const { store, hooks, seedGame, seedMember, seedProfile, seedProposal, seedSquad, GUILD_ID } =
  fixtures;

const SATURDAY_NIGHT = toBits([{ day: 6, block: 2 }]);

async function scenario(
  options: { squadSize?: number; userIds?: string[]; config?: Partial<SquadsConfig> } = {},
) {
  const harness = createHarness(options.config);
  const game = seedGame({ squadSize: options.squadSize ?? 3 });
  const userIds = options.userIds ?? [A, B, C];
  for (const userId of userIds) {
    seedProfile({ userId, gameId: game.id, availability: SATURDAY_NIGHT });
  }
  const thread = harness.guild.add(fakeThread());
  const message = await thread.send({ content: 'proposta' });
  const proposal = seedProposal({
    gameId: game.id,
    userIds,
    threadId: thread.id,
    messageId: message.id,
    expiresAt: new Date(NOW + 72 * HOUR_MS),
  });
  return { ...harness, game, thread, proposal };
}

const squadChannel = (harness: Awaited<ReturnType<typeof scenario>>, id: string | null) =>
  harness.guild.channels.cache.get(id ?? '') as FakeTextChannel | undefined;

describe('SquadService: propostas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('o primeiro aceite cria o squad, o canal privado e põe o membro', async () => {
    const s = await scenario();

    const result = await s.service.acceptProposal(s.discordGuild, s.proposal.id, A);

    expect(result.outcome).toBe('created');
    expect(store.squads).toHaveLength(1);
    const squad = store.squads[0]!;
    expect(squad).toMatchObject({ status: 'open', day: null, block: null, name: 'Helldivers 2 #1' });
    expect(s.guild.channels.create).toHaveBeenCalledTimes(1);
    expect(s.guild.channels.create.mock.calls[0]?.[0].parent).toBe(s.category.id);

    const channel = squadChannel(s, squad.textChannelId)!;
    expect(channel.permissionOverwrites.cache.get(A)?.allow.bitfield).toBe(SQUAD_MEMBER_TEXT_BITS);
    expect(channel.permissionOverwrites.cache.get(GUILD_ID)?.deny.bitfield).toBe(
      PermissionFlagsBits.ViewChannel,
    );
    expect(squad.voiceChannelId).toBe(s.voices[0]!.id);
    expect(store.members.map((member) => member.userId)).toEqual([A]);
    expect(store.profiles.find((profile) => profile.userId === A)?.status).toBe('in_squad');
    expect(store.proposals[0]).toMatchObject({
      squadId: squad.id,
      acceptedIds: [A],
      closedAt: null,
    });
    // O guia fixo é a primeira mensagem do canal: pinado, chamando o fundador.
    const guide = channel.sent[0]!;
    expect(embedOf(guide)?.title).toBe('> HELLDIVERS 2 #1');
    expect(guide.payload.content).toBe(`<@${A}>`);
    expect(guide.pinned).toBe(true);
    expect(squad.guideMessageId).toBe(guide.id);
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'squad.create', source: 'event', actor: A }),
    );
    // A contagem da proposta foi reeditada e os botões continuam lá.
    expect(componentsOf(s.thread.sent[0])).toHaveLength(1);
  });

  it('o segundo aceite ocupa uma vaga sem criar outro squad', async () => {
    const s = await scenario();
    await s.service.acceptProposal(s.discordGuild, s.proposal.id, A);

    const result = await s.service.acceptProposal(s.discordGuild, s.proposal.id, B);

    expect(result.outcome).toBe('joined');
    expect(store.squads).toHaveLength(1);
    expect(s.guild.channels.create).toHaveBeenCalledTimes(1);
    expect(store.members.map((member) => member.userId)).toEqual([A, B]);
    const channel = squadChannel(s, store.squads[0]!.textChannelId)!;
    expect(channel.permissionOverwrites.cache.get(B)?.allow.bitfield).toBe(SQUAD_MEMBER_TEXT_BITS);
    expect(channel.sent.at(-1)?.payload.content).toBe(`<@${B}>`);
  });

  it('aceitar de novo é idempotente', async () => {
    const s = await scenario();
    await s.service.acceptProposal(s.discordGuild, s.proposal.id, A);

    const again = await s.service.acceptProposal(s.discordGuild, s.proposal.id, A);

    expect(again.outcome).toBe('already');
    expect(store.squads).toHaveLength(1);
    expect(store.members).toHaveLength(1);
  });

  it('quem perde a corrida do primeiro aceite entra no squad de quem ganhou', async () => {
    const s = await scenario();
    const winnerChannel = s.guild.add(fakeTextChannel());
    // Outro "Aceito" commita enquanto a nossa transação ainda vai começar.
    hooks.beforeTransaction = () => {
      const winner = seedSquad({ gameId: s.game.id, textChannelId: winnerChannel.id });
      seedMember(winner.id, A);
      store.proposals[0]!.squadId = winner.id;
      store.proposals[0]!.acceptedIds = [A];
    };

    const result = await s.service.acceptProposal(s.discordGuild, s.proposal.id, B);

    expect(result.outcome).toBe('joined');
    expect(store.squads).toHaveLength(1);
    expect(result.squad?.id).toBe(store.squads[0]!.id);
    expect(s.guild.channels.create).not.toHaveBeenCalled();
    expect(store.members.map((member) => member.userId)).toEqual([A, B]);
    expect(winnerChannel.permissionOverwrites.cache.has(B)).toBe(true);
  });

  it('passar não cria nada', async () => {
    const s = await scenario();

    const result = await s.service.declineProposal(s.discordGuild, s.proposal.id, A);

    expect(result.outcome).toBe('declined');
    expect(store.squads).toHaveLength(0);
    expect(s.guild.channels.create).not.toHaveBeenCalled();
    expect(store.proposals[0]!.declinedIds).toEqual([A]);
  });

  it('encher vira full, fecha a proposta e tranca a thread', async () => {
    const s = await scenario({ squadSize: 2, userIds: [A, B] });

    await s.service.acceptProposal(s.discordGuild, s.proposal.id, A);
    await s.service.acceptProposal(s.discordGuild, s.proposal.id, B);

    expect(store.squads[0]!.status).toBe('full');
    expect(store.proposals[0]!.closedAt).not.toBeNull();
    expect(s.thread.edit).toHaveBeenLastCalledWith(
      expect.objectContaining({ archived: true, locked: true }),
    );
    expect(componentsOf(s.thread.sent[0])).toEqual([]);
  });

  it('aceite com o squad cheio é recusado e não põe ninguém', async () => {
    const s = await scenario({ squadSize: 2 });
    await s.service.acceptProposal(s.discordGuild, s.proposal.id, A);
    seedMember(store.squads[0]!.id, D);
    store.squads[0]!.status = 'full';

    await expect(s.service.acceptProposal(s.discordGuild, s.proposal.id, C)).rejects.toMatchObject({
      code: 'SQUAD_FULL',
      message: 'O squad já encheu.',
    });
    expect(store.members.map((member) => member.userId)).toEqual([A, D]);
    expect(store.proposals[0]!.acceptedIds).toEqual([A]);
  });

  it('passar depois de aceitar é recusado', async () => {
    const s = await scenario();
    await s.service.acceptProposal(s.discordGuild, s.proposal.id, A);

    await expect(s.service.declineProposal(s.discordGuild, s.proposal.id, A)).rejects.toMatchObject(
      {
        code: 'ALREADY_ACCEPTED',
        message: 'Você já aceitou. Para sair do squad use /squad sair.',
      },
    );
    expect(store.proposals[0]!.acceptedIds).toEqual([A]);
  });

  it('pool cheio deixa o squad sem voice preferido e avisa no guia', async () => {
    const s = await scenario();
    s.setConfig({ voicePoolIds: [s.voices[0]!.id] });
    seedSquad({ gameId: s.game.id, voiceChannelId: s.voices[0]!.id });

    await s.service.acceptProposal(s.discordGuild, s.proposal.id, A);

    const squad = store.squads.find((row) => row.textChannelId)!;
    expect(squad.voiceChannelId).toBeNull();
    const guide = embedOf(squadChannel(s, squad.textChannelId)!.sent[0]);
    expect(guide?.fields?.find((field) => field.name === 'Sala preferida')?.value).toBe(
      NO_VOICE_NOTE,
    );
  });

  it('sem categoria configurada recusa antes de gravar qualquer coisa', async () => {
    const s = await scenario({ config: { categoryId: null } });

    await expect(s.service.acceptProposal(s.discordGuild, s.proposal.id, A)).rejects.toMatchObject({
      code: 'SQUADS_NO_CATEGORY',
    });
    expect(store.proposals[0]!.acceptedIds).toEqual([]);
    expect(store.squads).toHaveLength(0);
  });

  it('proposta vencida expira no clique', async () => {
    const s = await scenario();
    s.clock.now = NOW + 73 * HOUR_MS;

    await expect(s.service.acceptProposal(s.discordGuild, s.proposal.id, A)).rejects.toMatchObject({
      code: 'PROPOSAL_EXPIRED',
    });
    expect(store.proposals[0]!.closedAt).not.toBeNull();
    expect(componentsOf(s.thread.sent[0])).toEqual([]);
  });

  it('quem não está na turma não aceita', async () => {
    const s = await scenario();

    await expect(s.service.acceptProposal(s.discordGuild, s.proposal.id, D)).rejects.toMatchObject({
      code: 'NOT_IN_PROPOSAL',
    });
  });

  it('módulo desligado responde MODULE_DISABLED', async () => {
    const s = await scenario({ config: { enabled: false } });

    await expect(s.service.acceptProposal(s.discordGuild, s.proposal.id, A)).rejects.toMatchObject({
      code: 'MODULE_DISABLED',
    });
  });
});
