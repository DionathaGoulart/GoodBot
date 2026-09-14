import { toBits } from '@goodbot/shared';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ALL_BUT_ADMIN,
  componentsOf,
  fakeSearchChannel,
  fakeTextChannel,
  fakeThread,
  fakeVoice,
} from './__fixtures__/discord';
import { A, B, C, createHarness, NOW } from './__fixtures__/harness';
import { log } from './context';
import { rankVacancyCandidates } from './matcher';

import type { TextChannel } from 'discord.js';

const fixtures = await vi.hoisted(async () => import('./__fixtures__/fake-db'));
vi.mock('@goodbot/db', () => fixtures.repositories);

const { store, repositories, seedGame, seedMember, seedProfile, seedProposal, seedSquad, GUILD_ID } =
  fixtures;

const PING_ROLE = '700000000000000009';
const SATURDAY_NIGHT = toBits([{ day: 6, block: 2 }]);

function scenario(userIds: string[] = [A, B]) {
  const harness = createHarness({ pingRoleId: PING_ROLE });
  const game = seedGame({ squadSize: 3 });
  for (const userId of userIds) {
    seedProfile({ userId, gameId: game.id, availability: SATURDAY_NIGHT });
  }
  return { ...harness, game };
}

describe('SquadService: matcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pula sem canal de busca', async () => {
    const s = scenario();
    s.setConfig({ searchChannelId: null });

    expect(await s.service.runMatch(s.guild.id, s.game.id)).toEqual({
      proposals: 0,
      joinRequests: 0,
    });
    expect(s.search.threads.create).not.toHaveBeenCalled();
  });

  it('pula sem permissão de criar thread privada', async () => {
    const s = scenario();
    const locked = fakeSearchChannel(
      s.guild,
      ALL_BUT_ADMIN & ~PermissionFlagsBits.CreatePrivateThreads,
    );
    s.setConfig({ searchChannelId: locked.id });

    expect(await s.service.runMatch(s.guild.id, s.game.id)).toEqual({
      proposals: 0,
      joinRequests: 0,
    });
    expect(locked.threads.create).not.toHaveBeenCalled();
  });

  it('abre a proposta numa thread privada mencionando só os jogadores, nunca o cargo', async () => {
    const s = scenario();

    const result = await s.service.runMatch(s.guild.id, s.game.id);

    expect(result).toEqual({ proposals: 1, joinRequests: 0 });
    expect(s.search.threads.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: ChannelType.PrivateThread, invitable: false }),
    );
    const thread = s.search.threads.created[0]!;
    expect(thread.members.add.mock.calls.map(([id]) => id)).toEqual([A, B]);
    const message = thread.sent[0]!;
    expect(message.payload.content).toBe(`<@${A}> <@${B}>`);
    expect(String(message.payload.content)).not.toContain(PING_ROLE);
    expect(message.payload.allowedMentions).toEqual({ users: [A, B] });
    expect(componentsOf(message)).toHaveLength(1);
    expect(store.proposals[0]).toMatchObject({
      userIds: [A, B],
      threadId: thread.id,
      messageId: message.id,
    });
    expect(store.proposals[0]!.expiresAt.getTime()).toBe(NOW + 72 * 3_600_000);
    expect(store.profiles.every((profile) => profile.lastMatchedAt !== null)).toBe(true);
  });

  it('não repropõe a mesma dupla dentro do cooldown', async () => {
    const s = scenario();
    seedProposal({ gameId: s.game.id, userIds: [A, B], threadId: '1', closedAt: new Date(NOW) });

    expect(await s.service.runMatch(s.guild.id, s.game.id)).toEqual({
      proposals: 0,
      joinRequests: 0,
    });
  });

  it('vaga aberta compatível vira pedido de entrada, não proposta', async () => {
    const s = scenario([C]);
    const channel = s.guild.add(fakeTextChannel());
    const squad = seedSquad({ gameId: s.game.id, textChannelId: channel.id, day: 6, block: 2 });
    seedMember(squad.id, A);
    seedProfile({ userId: A, gameId: s.game.id, availability: SATURDAY_NIGHT, status: 'in_squad' });

    const result = await s.service.runMatch(s.guild.id, s.game.id);

    expect(result).toEqual({ proposals: 0, joinRequests: 1 });
    expect(store.requests[0]).toMatchObject({ squadId: squad.id, userId: C, status: 'pending' });
    expect(s.search.threads.create).not.toHaveBeenCalled();
  });

  it('duas chamadas ao mesmo tempo rodam uma passada só', async () => {
    const s = scenario();

    const [first, second] = await Promise.all([
      s.service.runMatch(s.guild.id, s.game.id),
      s.service.runMatch(s.guild.id, s.game.id),
    ]);

    expect(first).toEqual({ proposals: 1, joinRequests: 0 });
    expect(second).toEqual(first);
    expect(s.search.threads.create).toHaveBeenCalledTimes(1);
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Deixa as promessas já resolvidas andarem. */
const settle = () => new Promise((done) => setImmediate(done));

describe('MatcherService: fila por guild e jogo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('duas tarefas no mesmo jogo não se sobrepõem', async () => {
    const { parts } = scenario();
    const gate = deferred();
    const order: string[] = [];

    const first = parts.matcher.withGameLock(GUILD_ID, 'jogo', async () => {
      order.push('primeira começou');
      await gate.promise;
      order.push('primeira acabou');
      return 1;
    });
    const second = parts.matcher.withGameLock(GUILD_ID, 'jogo', async () => {
      order.push('segunda');
      return 2;
    });
    await settle();
    expect(order).toEqual(['primeira começou']);

    gate.resolve();
    expect(await Promise.all([first, second])).toEqual([1, 2]);
    expect(order).toEqual(['primeira começou', 'primeira acabou', 'segunda']);
  });

  it('jogos diferentes rodam em paralelo, e tarefa aninhada em outro jogo não trava', async () => {
    const { parts } = scenario();
    const gate = deferred();

    const held = parts.matcher.withGameLock(GUILD_ID, 'um', () => gate.promise);
    const other = parts.matcher.withGameLock(GUILD_ID, 'dois', async () => 'livre');
    const nested = parts.matcher.withGameLock(GUILD_ID, 'tres', () =>
      parts.matcher.withGameLock(GUILD_ID, 'quatro', async () => 'aninhada'),
    );

    expect(await other).toBe('livre');
    expect(await nested).toBe('aninhada');
    gate.resolve();
    await held;
  });

  it('tarefa que lança não trava a fila', async () => {
    const { parts } = scenario();

    const failed = parts.matcher.withGameLock(GUILD_ID, 'jogo', async () => {
      throw new Error('falhou');
    });
    const next = parts.matcher.withGameLock(GUILD_ID, 'jogo', async () => 'seguiu');

    await expect(failed).rejects.toThrow('falhou');
    expect(await next).toBe('seguiu');
  });

  it('a passada espera a fila e continua deduplicada', async () => {
    const s = scenario();
    const gate = deferred();
    const held = s.parts.matcher.withGameLock(GUILD_ID, s.game.id, () => gate.promise);

    const runs = [s.service.runMatch(GUILD_ID, s.game.id), s.service.runMatch(GUILD_ID, s.game.id)];
    await settle();
    expect(s.search.threads.create).not.toHaveBeenCalled();

    gate.resolve();
    await held;
    const [first, second] = await Promise.all(runs);
    expect(first).toEqual({ proposals: 1, joinRequests: 0 });
    expect(second).toBe(first);
    expect(s.search.threads.create).toHaveBeenCalledTimes(1);
  });
});

describe('MatcherService: canal de busca e abertura de proposta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('searchChannel diz por que o canal não serve', async () => {
    const s = scenario();
    const matcher = s.parts.matcher;

    expect(await matcher.searchChannel(s.discordGuild, { searchChannelId: null })).toEqual({
      ok: false,
      reason: 'no-channel',
      missing: [],
    });
    const voice = s.guild.add(fakeVoice());
    expect(await matcher.searchChannel(s.discordGuild, { searchChannelId: voice.id })).toEqual({
      ok: false,
      reason: 'not-text',
      missing: [],
    });
    const locked = fakeSearchChannel(
      s.guild,
      ALL_BUT_ADMIN & ~PermissionFlagsBits.CreatePrivateThreads,
    );
    expect(await matcher.searchChannel(s.discordGuild, { searchChannelId: locked.id })).toEqual({
      ok: false,
      reason: 'missing-permissions',
      missing: ['CreatePrivateThreads'],
    });
    expect(await matcher.searchChannel(s.discordGuild, { searchChannelId: s.search.id })).toEqual({
      ok: true,
      channel: s.search,
    });
  });

  it('a nota vai na thread depois da mensagem gravada, e falha dela só vai para o log', async () => {
    const s = scenario();
    const config = await s.configService.get();
    const group = { userIds: [A, B], mask: SATURDAY_NIGHT, slot: { day: 6, block: 2 } };
    const open = () =>
      s.parts.matcher.openProposal(
        s.discordGuild,
        s.search as unknown as TextChannel,
        s.game,
        config,
        group,
        { note: { content: 'nota da staff' } },
      );

    const proposal = await open();

    const thread = s.search.threads.created[0]!;
    expect(proposal).toMatchObject({ userIds: [A, B], messageId: thread.sent[0]!.id });
    expect(thread.sent[1]!.payload).toEqual({ content: 'nota da staff' });
    expect(repositories.setSquadProposalMessage.mock.invocationCallOrder[0]!).toBeLessThan(
      thread.send.mock.invocationCallOrder[1]!,
    );

    // Segunda proposta, agora com a nota recusada pelo Discord.
    const warn = vi.spyOn(log, 'warn');
    s.search.threads.create.mockImplementationOnce(async () => {
      const failing = s.guild.add(fakeThread());
      const send = failing.send.getMockImplementation()!;
      failing.send.mockImplementationOnce(send).mockRejectedValueOnce(new Error('Missing Access'));
      s.search.threads.created.push(failing);
      return failing;
    });

    const second = await open();

    const failing = s.search.threads.created[1]!;
    expect(second).not.toBeNull();
    expect(failing.delete).not.toHaveBeenCalled();
    expect(store.proposals.filter((row) => row.closedAt === null)).toHaveLength(2);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: second!.id }),
      'não foi possível mandar a nota na thread da proposta',
    );
    warn.mockRestore();
  });
});

describe('rankVacancyCandidates', () => {
  const fields = [{ key: 'platform', type: 'select' as const, match: 'hard' as const }];
  const member = { userId: A, availability: SATURDAY_NIGHT, answers: { platform: 'PC' } };

  it('exige a janela do squad, campo hard compatível e dupla fora do cooldown', () => {
    const ranked = rankVacancyCandidates({
      slot: { day: 6, block: 2 },
      fields,
      memberIds: [A],
      memberProfiles: [member],
      candidates: [
        { userId: B, availability: SATURDAY_NIGHT, answers: { platform: 'PC' } },
        { userId: C, availability: SATURDAY_NIGHT, answers: { platform: 'PS5' } },
        { userId: '300000000000000005', availability: toBits([{ day: 0, block: 0 }]), answers: {} },
        { userId: '300000000000000006', availability: SATURDAY_NIGHT, answers: {} },
      ],
      blockedPairs: new Set([`${A}:300000000000000006`]),
    });

    expect(ranked.map((fit) => fit.userId)).toEqual([B]);
  });
});
