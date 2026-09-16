import { HOUR_MS } from '@goodbot/shared';
import { PermissionFlagsBits } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ALL_BUT_ADMIN, componentsOf, embedOf, fakeTextChannel } from './__fixtures__/discord';
import { A, B, createHarness, NOW } from './__fixtures__/harness';

const fixtures = await vi.hoisted(async () => import('./__fixtures__/fake-db'));
vi.mock('@goodbot/db', () => fixtures.repositories);

const { store, seedGame, seedMember, seedSession, seedSquad } = fixtures;

function scenario(options: { channelPermissions?: bigint } = {}) {
  const harness = createHarness();
  const game = seedGame({ groupSize: 4, partySize: 4 });
  const channel = harness.guild.add(
    fakeTextChannel(
      options.channelPermissions === undefined ? {} : { permissions: options.channelPermissions },
    ),
  );
  const squad = seedSquad({ gameId: game.id, textChannelId: channel.id, name: 'Os Bravos' });
  seedMember(squad.id, A);
  seedMember(squad.id, B);
  return { ...harness, game, channel, squad };
}

const squadRow = () => store.squads[0]!;
const fieldOf = (message: Parameters<typeof embedOf>[0], name: string) =>
  embedOf(message)?.fields?.find((field) => field.name === name)?.value;

describe('GuideService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publica, pina e grava; a criação chama os membros', async () => {
    const s = scenario();

    const id = await s.parts.guide.publish(s.discordGuild, s.squad.id, { mentionMembers: true });

    const message = s.channel.sent[0]!;
    expect(id).toBe(message.id);
    expect(squadRow().guideMessageId).toBe(message.id);
    expect(message.pinned).toBe(true);
    expect(message.payload.content).toBe(`<@${A}> <@${B}>`);
    expect(embedOf(message)?.title).toBe('> OS BRAVOS');
    expect(fieldOf(message, 'Membros (2 de 4)')).toBe(`<@${A}>, <@${B}>`);
    expect(fieldOf(message, 'Vagas')).toContain('2 abertas');
    expect(componentsOf(message)).toHaveLength(1);
  });

  it('sem PinMessages no canal, o guia sai sem pin', async () => {
    const s = scenario({ channelPermissions: ALL_BUT_ADMIN & ~PermissionFlagsBits.PinMessages });

    await s.parts.guide.publish(s.discordGuild, s.squad.id, { mentionMembers: false });

    expect(s.channel.sent[0]!.pinned).toBe(false);
    expect(squadRow().guideMessageId).toBe(s.channel.sent[0]!.id);
  });

  it('refresh reedita a mesma mensagem, sem pingar, com as próximas jogatinas', async () => {
    const s = scenario();
    await s.parts.guide.publish(s.discordGuild, s.squad.id, { mentionMembers: true });
    seedSession({
      squadId: s.squad.id,
      startsAt: new Date(NOW + HOUR_MS),
      endsAt: new Date(NOW + 4 * HOUR_MS),
      goingIds: [A, B],
    });
    seedSession({
      squadId: s.squad.id,
      startsAt: new Date(NOW - 5 * HOUR_MS),
      endsAt: new Date(NOW - 2 * HOUR_MS),
    });

    await s.parts.guide.refresh(s.discordGuild, s.squad.id);

    expect(s.channel.sent).toHaveLength(1);
    const message = s.channel.sent[0]!;
    expect(message.payload.content).toBe('');
    expect(message.payload.allowedMentions).toEqual({ users: [] });
    const next = fieldOf(message, 'Próximas jogatinas') ?? '';
    expect(next).toContain('2 vão');
    expect(next.split('\n')).toHaveLength(1);
  });

  it('guia apagado é publicado de novo; falha passageira não duplica', async () => {
    const s = scenario();
    await s.parts.guide.publish(s.discordGuild, s.squad.id, { mentionMembers: false });
    const first = s.channel.sent[0]!;

    s.channel.messages.fetch.mockRejectedValueOnce(Object.assign(new Error('503'), { code: 0 }));
    expect(await s.parts.guide.refresh(s.discordGuild, s.squad.id)).toBeNull();
    expect(s.channel.sent).toHaveLength(1);

    first.deleted = true;
    const id = await s.parts.guide.refresh(s.discordGuild, s.squad.id);
    expect(id).toBe(s.channel.sent[1]!.id);
    expect(squadRow().guideMessageId).toBe(id);
  });

  it('quem perde a corrida pela gravação apaga a mensagem que mandou', async () => {
    const s = scenario();
    const send = s.channel.send.getMockImplementation()!;
    s.channel.send.mockImplementationOnce(async (payload) => {
      squadRow().guideMessageId = '600000000000009999';
      return send(payload);
    });

    const id = await s.parts.guide.publish(s.discordGuild, s.squad.id, { mentionMembers: false });

    expect(id).toBe('600000000000009999');
    expect(s.channel.sent[0]!.deleted).toBe(true);
  });

  it('arquivado: o guia vira aviso sem botões, e squad arquivado sem guia não ganha um', async () => {
    const s = scenario();
    await s.parts.guide.publish(s.discordGuild, s.squad.id, { mentionMembers: false });
    squadRow().status = 'archived';

    await s.parts.guide.refresh(s.discordGuild, s.squad.id);
    expect(embedOf(s.channel.sent[0])?.title).toBe('> OS BRAVOS (ARQUIVADO)');
    expect(componentsOf(s.channel.sent[0])).toEqual([]);

    const other = s.guild.add(fakeTextChannel());
    const archived = seedSquad({ gameId: s.game.id, textChannelId: other.id, status: 'archived' });
    expect(await s.parts.guide.refresh(s.discordGuild, archived.id)).toBeNull();
    expect(other.sent).toEqual([]);
  });

  it('syncAll põe guia nos squads vivos que não têm', async () => {
    const s = scenario();
    const other = s.guild.add(fakeTextChannel());
    seedSquad({ gameId: s.game.id, textChannelId: other.id });

    expect(await s.service.syncGuides(s.discordGuild)).toBe(2);
    expect(store.squads.every((squad) => squad.guideMessageId !== null)).toBe(true);
    expect(await s.service.syncGuides(s.discordGuild)).toBe(2);
    expect(s.channel.sent).toHaveLength(1);
  });

  it('servidor que deixa entrar em mais de um squad ganha PROCURAR OUTRO SQUAD', async () => {
    const s = scenario();
    s.setConfig({ maxSquadsPerUser: 2 });

    await s.parts.guide.publish(s.discordGuild, s.squad.id, { mentionMembers: false });

    const row = componentsOf(s.channel.sent[0])[0] as { toJSON(): { components: { label?: string }[] } };
    expect(row.toJSON().components.map((button) => button.label)).toEqual([
      'BORA',
      'RENOMEAR',
      'PROCURAR OUTRO SQUAD',
      'SAIR DO SQUAD',
    ]);
  });
});
