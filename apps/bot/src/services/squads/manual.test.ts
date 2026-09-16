import { pairKey, toBits } from '@goodbot/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { A, B, C, createHarness, D, NOW } from './__fixtures__/harness';

import type { SquadProfile } from '@goodbot/db';

const fixtures = await vi.hoisted(async () => import('./__fixtures__/fake-db'));
vi.mock('@goodbot/db', () => fixtures.repositories);

const { store, impl, seedGame, seedMember, seedProfile, seedProposal, seedSquad, GUILD_ID } =
  fixtures;

const ADMIN = '300000000000000010';
const OUTSIDER = '300000000000000009';
const SATURDAY_NIGHT = toBits([{ day: 6, block: 2 }]);

function scenario(options: { size?: number } = {}) {
  const harness = createHarness();
  const game = seedGame({ groupSize: options.size ?? 3, partySize: options.size ?? 3 });
  const profile = (userId: string, extra: Partial<SquadProfile> = {}) =>
    seedProfile({ userId, gameId: game.id, availability: SATURDAY_NIGHT, ...extra });
  const check = (userIds: string[]) =>
    harness.service.checkManualMatch(harness.discordGuild, game.id, { actorId: ADMIN, userIds });
  const propose = (userIds: string[], confirmedWarnings: string[] = []) =>
    harness.service.proposeManually(harness.discordGuild, game.id, {
      actorId: ADMIN,
      userIds,
      confirmedWarnings,
    });
  return { ...harness, game, profile, check, propose };
}

const keys = (issues: readonly { key: string }[]) => issues.map((issue) => issue.key);

describe('SquadService: revisão do match manual', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('proposta aberta, squad deste jogo e quem saiu do servidor bloqueiam, sem escrever nada', async () => {
    const s = scenario({ size: 4 });
    for (const userId of [A, B, C, D]) s.profile(userId);
    seedProposal({ gameId: s.game.id, userIds: [A, OUTSIDER], threadId: '1' });
    const squad = seedSquad({ gameId: s.game.id });
    seedMember(squad.id, B);
    s.guild.leave(C);

    const result = await s.check([A, B, C, D]);

    expect(keys(result.blocks)).toEqual([
      `NOT_IN_GUILD:${C}`,
      `IN_SQUAD_IN_GAME:${B}`,
      `IN_OPEN_PROPOSAL:${A}`,
    ]);
    expect(store.proposals).toHaveLength(1);
    expect(s.search.threads.create).not.toHaveBeenCalled();
    expect(s.audit.record).not.toHaveBeenCalled();
  });

  it('teto de squads por outro jogo, cooldown, campo hard, pausado, pedido e turma grande só avisam', async () => {
    const s = scenario({ size: 3 });
    s.profile(A);
    s.profile(B);
    s.profile(C, { answers: { platform: 'PS5' } });
    s.profile(D, { status: 'paused' });
    const other = seedSquad({ gameId: seedGame({ name: 'Deep Rock' }).id });
    seedMember(other.id, A);
    seedProposal({ gameId: s.game.id, userIds: [A, B], threadId: '1', closedAt: new Date(NOW) });
    const here = seedSquad({ gameId: s.game.id });
    seedMember(here.id, OUTSIDER);
    await impl.createSquadJoinRequest(null, { guildId: GUILD_ID, squadId: here.id, userId: B });

    const result = await s.check([D, C, B, A]);

    expect(result.blocks).toEqual([]);
    expect(keys(result.warnings)).toEqual([
      'GROUP_OVER_SIZE',
      `NOT_SEARCHING:${D}`,
      `AT_SQUAD_LIMIT:${A}`,
      `PAIR_COOLDOWN:${pairKey(A, B)}`,
      `HARD_MISMATCH:${pairKey(A, C)}`,
      `HARD_MISMATCH:${pairKey(B, C)}`,
      `HARD_MISMATCH:${pairKey(C, D)}`,
      `PENDING_JOIN_REQUEST:${B}`,
    ]);
    expect(result.slot).toEqual({ day: 6, block: 2 });
    expect(store.proposals).toHaveLength(1);
  });
});

describe('SquadService: propor ao grupo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('abre a thread só com os escolhidos, deixa a nota da staff sem chamar o admin e audita', async () => {
    const s = scenario();
    for (const userId of [A, B, C]) s.profile(userId);

    const result = await s.propose([B, A]);

    expect(result.outcome).toBe('done');
    const thread = s.search.threads.created[0]!;
    expect(thread.members.add.mock.calls.map(([id]) => id)).toEqual([A, B]);
    expect(thread.sent[1]?.payload).toEqual({
      content: expect.stringContaining(`<@${ADMIN}>`),
      allowedMentions: { users: [] },
    });
    expect(store.proposals[0]).toMatchObject({ userIds: [A, B], messageId: thread.sent[0]!.id });
    const matched = (userId: string) =>
      store.profiles.find((profile) => profile.userId === userId)?.lastMatchedAt;
    expect(matched(A)).not.toBeNull();
    expect(matched(C)).toBeNull();
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'squad.proposal.manual',
        source: 'dashboard',
        actor: ADMIN,
        target: { type: 'squad_proposal', id: store.proposals[0]!.id },
      }),
    );
  });

  it('turma de três: o primeiro aceite cria o squad, o segundo entra e o terceiro passa', async () => {
    const s = scenario({ size: 3 });
    for (const userId of [A, B, C]) s.profile(userId);
    await s.propose([A, B, C]);
    const proposalId = store.proposals[0]!.id;

    expect((await s.service.acceptProposal(s.discordGuild, proposalId, A)).outcome).toBe(
      'created',
    );
    expect((await s.service.acceptProposal(s.discordGuild, proposalId, B)).outcome).toBe('joined');
    expect((await s.service.declineProposal(s.discordGuild, proposalId, C)).outcome).toBe(
      'declined',
    );

    expect(store.squads).toHaveLength(1);
    expect(store.members.map((member) => member.userId)).toEqual([A, B]);
    expect(store.proposals[0]!.closedAt).not.toBeNull();
  });

  it('bloqueio não abre thread, inclusive quem já está num squad do jogo', async () => {
    const s = scenario();
    s.profile(A, { status: 'in_squad' });
    s.profile(B);
    seedMember(seedSquad({ gameId: s.game.id }).id, A);

    const result = await s.propose([A, B]);

    expect(result.outcome).toBe('blocked');
    expect(keys(result.check.blocks)).toEqual([`IN_SQUAD_IN_GAME:${A}`]);
    expect(s.search.threads.create).not.toHaveBeenCalled();
  });

  it('aviso sem confirmação volta unconfirmed; confirmando as keys, a proposta sai', async () => {
    const s = scenario();
    s.profile(A, { status: 'paused' });
    s.profile(B);

    const first = await s.propose([A, B]);
    expect(first).toMatchObject({ outcome: 'unconfirmed' });
    expect(first.outcome === 'unconfirmed' && keys(first.pending)).toEqual([`NOT_SEARCHING:${A}`]);
    expect(s.search.threads.create).not.toHaveBeenCalled();

    const second = await s.propose([A, B], [`NOT_SEARCHING:${A}`]);
    expect(second.outcome).toBe('done');
    expect(s.search.threads.create).toHaveBeenCalledTimes(1);
  });

  it('a segunda chamada igual cai em IN_OPEN_PROPOSAL, também em clique duplo simultâneo', async () => {
    const s = scenario();
    s.profile(A);
    s.profile(B);

    const [one, two] = await Promise.all([s.propose([A, B]), s.propose([A, B])]);
    const again = await s.propose([A, B]);

    expect([one.outcome, two.outcome].sort()).toEqual(['blocked', 'done']);
    expect(keys(again.check.blocks)).toEqual([`IN_OPEN_PROPOSAL:${A}`, `IN_OPEN_PROPOSAL:${B}`]);
    expect(s.search.threads.create).toHaveBeenCalledTimes(1);
  });

  it('a passada do matcher e a proposta manual juntas não propõem as mesmas pessoas duas vezes', async () => {
    const s = scenario();
    s.profile(A);
    s.profile(B);

    const [match, manual] = await Promise.all([
      s.service.runMatch(GUILD_ID, s.game.id),
      s.propose([A, B]),
    ]);

    expect(match.proposals + (manual.outcome === 'done' ? 1 : 0)).toBe(1);
    expect(store.proposals).toHaveLength(1);
    expect(s.search.threads.create).toHaveBeenCalledTimes(1);
  });

  it('sem canal de busca a proposta vira erro para o admin', async () => {
    const s = scenario();
    s.profile(A);
    s.profile(B);
    s.setConfig({ searchChannelId: null });

    await expect(s.propose([A, B])).rejects.toMatchObject({ code: 'SQUADS_NO_SEARCH_CHANNEL' });
    expect(store.proposals).toHaveLength(0);
  });
});
