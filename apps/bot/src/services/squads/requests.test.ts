import { toBits } from '@goodbot/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BOT_ID, componentsOf, embedOf, fakeTextChannel } from './__fixtures__/discord';
import { A, B, C, createHarness } from './__fixtures__/harness';
import { squadTextOverwrites } from './overwrites';

const fixtures = await vi.hoisted(async () => import('./__fixtures__/fake-db'));
vi.mock('@goodbot/db', () => fixtures.repositories);

const { store, seedGame, seedMember, seedProfile, seedSquad, GUILD_ID } = fixtures;

async function scenario(options: { size?: number; members?: string[] } = {}) {
  const harness = createHarness();
  const members = options.members ?? [A, B];
  const game = seedGame({ squadSize: options.size ?? 3 });
  const channel = harness.guild.add(
    fakeTextChannel({
      overwrites: squadTextOverwrites({ everyoneId: GUILD_ID, botId: BOT_ID, memberIds: members }),
    }),
  );
  const squad = seedSquad({ gameId: game.id, textChannelId: channel.id });
  const availability = toBits([{ day: 6, block: 2 }]);
  for (const userId of members) {
    seedMember(squad.id, userId);
    seedProfile({ userId, gameId: game.id, availability, status: 'in_squad' });
  }
  seedProfile({ userId: C, gameId: game.id, availability, answers: { platform: 'PC' } });
  const request = await harness.service.createJoinRequest(
    harness.discordGuild,
    squad,
    C,
    'matcher',
  );
  return { ...harness, game, channel, squad, request: request! };
}

const requestRow = () => store.requests[0]!;

describe('SquadService: pedidos de entrada', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('o pedido sai no canal do squad, com botões e sem pingar ninguém', async () => {
    const s = await scenario();

    expect(requestRow()).toMatchObject({ status: 'pending', messageId: s.channel.sent[0]!.id });
    const message = s.channel.sent[0]!;
    expect(message.payload.content).toBeUndefined();
    expect(message.payload.allowedMentions).toEqual({ parse: [] });
    expect(componentsOf(message)).toHaveLength(1);
    expect(embedOf(message)?.fields).toContainEqual({
      name: 'Plataforma',
      value: 'PC',
      inline: true,
    });
  });

  it('um aceite basta para o candidato entrar', async () => {
    const s = await scenario();

    const decision = await s.service.acceptJoinRequest(s.discordGuild, s.request.id, A);

    expect(decision.outcome).toBe('accepted');
    expect(requestRow()).toMatchObject({ status: 'accepted', decidedBy: A });
    expect(store.members.map((member) => member.userId)).toEqual([A, B, C]);
    expect(s.channel.permissionOverwrites.cache.has(C)).toBe(true);
    const joined = s.channel.sent.find((message) => embedOf(message)?.title === '> CHEGOU REFORÇO');
    expect(joined?.payload.content).toBe(`<@${C}>`);
    expect(store.profiles.find((profile) => profile.userId === C)?.status).toBe('in_squad');
    expect(componentsOf(s.channel.sent[0])).toEqual([]);
  });

  it('uma recusa só registra o voto e o pedido segue pendente', async () => {
    const s = await scenario();

    const decision = await s.service.declineJoinRequest(s.discordGuild, s.request.id, A);

    expect(decision.outcome).toBe('recorded');
    expect(requestRow()).toMatchObject({ status: 'pending', declinedIds: [A] });
    expect(componentsOf(s.channel.sent[0])).toHaveLength(1);
  });

  it('quando todos recusam, o pedido é recusado', async () => {
    const s = await scenario();

    await s.service.declineJoinRequest(s.discordGuild, s.request.id, A);
    const decision = await s.service.declineJoinRequest(s.discordGuild, s.request.id, B);

    expect(decision.outcome).toBe('declined');
    expect(requestRow().status).toBe('declined');
    expect(store.members.map((member) => member.userId)).toEqual([A, B]);
    expect(componentsOf(s.channel.sent[0])).toEqual([]);
  });

  it('só membro decide', async () => {
    const s = await scenario();

    await expect(
      s.service.acceptJoinRequest(s.discordGuild, s.request.id, C),
    ).rejects.toMatchObject({
      code: 'NOT_A_MEMBER',
    });
  });

  it('squad cheio encerra o pedido em vez de pôr alguém a mais', async () => {
    const s = await scenario({ size: 2 });

    await expect(
      s.service.acceptJoinRequest(s.discordGuild, s.request.id, A),
    ).rejects.toMatchObject({
      code: 'SQUAD_FULL',
    });
    expect(requestRow().status).toBe('expired');
    expect(store.members).toHaveLength(2);
  });

  it('aceitar um pedido já decidido é idempotente', async () => {
    const s = await scenario();
    await s.service.acceptJoinRequest(s.discordGuild, s.request.id, A);

    const again = await s.service.acceptJoinRequest(s.discordGuild, s.request.id, B);

    expect(again).toEqual({ outcome: 'already', status: 'accepted' });
    expect(store.members).toHaveLength(3);
  });
});
