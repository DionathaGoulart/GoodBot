import { toBits } from '@goodbot/shared';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ALL_BUT_ADMIN,
  componentsOf,
  fakeSearchChannel,
  fakeTextChannel,
} from './__fixtures__/discord';
import { A, B, C, createHarness, NOW } from './__fixtures__/harness';
import { rankVacancyCandidates } from './matcher';

const fixtures = await vi.hoisted(async () => import('./__fixtures__/fake-db'));
vi.mock('@goodbot/db', () => fixtures.repositories);

const { store, seedGame, seedMember, seedProfile, seedProposal, seedSquad } = fixtures;

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
