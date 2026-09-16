import { toBits } from '@goodbot/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BOT_ID, componentsOf, fakeTextChannel } from './__fixtures__/discord';
import { A, B, C, createHarness, D } from './__fixtures__/harness';
import { parseSquadCustomId } from './ids';
import { squadTextOverwrites } from './overwrites';

const fixtures = await vi.hoisted(async () => import('./__fixtures__/fake-db'));
vi.mock('@goodbot/db', () => fixtures.repositories);

const { store, repositories, seedGame, seedMember, seedProfile, seedSquad, GUILD_ID } = fixtures;

const saturdayNight = toBits([{ day: 6, block: 2 }]);
const ROLE = '700000000000000009';

function customIdsOf(message: Parameters<typeof componentsOf>[0]) {
  return (componentsOf(message) as { toJSON(): { components: { custom_id: string }[] } }[]).flatMap(
    (row) => row.toJSON().components.map((component) => parseSquadCustomId(component.custom_id)),
  );
}

/** Squad aberto de sábado à noite com A e B, ambos no PC. */
function squadScenario(options: { size?: number } = {}) {
  const harness = createHarness();
  const game = seedGame({ squadSize: options.size ?? 3 });
  const channel = harness.guild.add(
    fakeTextChannel({
      overwrites: squadTextOverwrites({ everyoneId: GUILD_ID, botId: BOT_ID, memberIds: [A, B] }),
    }),
  );
  const squad = seedSquad({ gameId: game.id, textChannelId: channel.id });
  for (const userId of [A, B]) {
    seedMember(squad.id, userId);
    seedProfile({ userId, gameId: game.id, availability: saturdayNight, status: 'in_squad' });
  }
  return { ...harness, game, channel, squad };
}

describe('SquadService: mensagem fixa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publica um botão por jogo ligado, pinga o cargo e grava a mensagem no config', async () => {
    const h = createHarness({ pingRoleId: ROLE });
    const game = seedGame();
    seedGame({ name: 'Desligado', enabled: false });

    const published = await h.service.publishSearchMessage(h.discordGuild, A);

    const message = h.search.sent[0]!;
    expect(published).toEqual({ channelId: h.search.id, messageId: message.id });
    expect(message.payload.content).toBe(`<@&${ROLE}>`);
    expect(message.payload.allowedMentions).toEqual({ parse: [], roles: [ROLE] });
    expect(customIdsOf(message)).toEqual([{ kind: 'profile-start', gameId: game.id }]);
    expect(repositories.setModuleConfig).toHaveBeenCalledWith(
      expect.anything(),
      GUILD_ID,
      'squads',
      expect.objectContaining({ searchChannelId: h.search.id, searchMessageId: message.id }),
      A,
    );
    expect(h.configService.publishInvalidate).toHaveBeenCalledWith(GUILD_ID, 'squads');
  });

  it('republicar no mesmo canal edita a mensagem em vez de mandar outra', async () => {
    const h = createHarness();
    seedGame();
    const first = await h.service.publishSearchMessage(h.discordGuild, A);
    h.setConfig({ searchMessageId: first.messageId });

    const second = await h.service.publishSearchMessage(h.discordGuild, A);

    expect(second.messageId).toBe(first.messageId);
    expect(h.search.sent).toHaveLength(1);
    expect(h.search.sent[0]!.edit).toHaveBeenCalledTimes(1);
  });

  it('sem jogo ligado não publica nada', async () => {
    const h = createHarness();

    await expect(h.service.publishSearchMessage(h.discordGuild, A)).rejects.toMatchObject({
      code: 'SQUADS_NO_GAMES',
    });
    expect(h.search.send).not.toHaveBeenCalled();
    expect(repositories.setModuleConfig).not.toHaveBeenCalled();
  });
});

describe('SquadService: squads com vaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lista o squad que joga num horário marcado e com respostas compatíveis', async () => {
    const s = squadScenario();
    seedProfile({ userId: C, gameId: s.game.id, availability: saturdayNight });

    const list = await s.service.listJoinableSquads(GUILD_ID, C, s.game.id);

    expect(list.map((entry) => entry.squad.id)).toEqual([s.squad.id]);
    expect(list[0]?.memberCount).toBe(2);
  });

  it('fora da janela do squad ou com campo hard diferente, não lista', async () => {
    const s = squadScenario();
    seedProfile({ userId: C, gameId: s.game.id, availability: toBits([{ day: 1, block: 0 }]) });
    seedProfile({
      userId: D,
      gameId: s.game.id,
      availability: saturdayNight,
      answers: { platform: 'PS5' },
    });

    expect(await s.service.listJoinableSquads(GUILD_ID, C, s.game.id)).toEqual([]);
    expect(await s.service.listJoinableSquads(GUILD_ID, D, s.game.id)).toEqual([]);
  });

  it('sem perfil com horário, pede para montar o perfil', async () => {
    const s = squadScenario();

    await expect(s.service.listJoinableSquads(GUILD_ID, C, s.game.id)).rejects.toMatchObject({
      code: 'PROFILE_NOT_FOUND',
    });
  });
});

describe('SquadService: pedido manual', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('manda o pedido ao canal do squad', async () => {
    const s = squadScenario();
    seedProfile({ userId: C, gameId: s.game.id, availability: saturdayNight });

    const sent = await s.service.requestToJoin(s.discordGuild, C, s.squad.id);

    expect(sent.squad.id).toBe(s.squad.id);
    expect(store.requests).toEqual([expect.objectContaining({ userId: C, status: 'pending' })]);
    expect(s.channel.sent).toHaveLength(1);
  });

  it('pedido repetido: primeiro pendente, depois de recusado em cooldown', async () => {
    const s = squadScenario();
    seedProfile({ userId: C, gameId: s.game.id, availability: saturdayNight });
    await s.service.requestToJoin(s.discordGuild, C, s.squad.id);

    await expect(s.service.requestToJoin(s.discordGuild, C, s.squad.id)).rejects.toMatchObject({
      code: 'REQUEST_PENDING',
    });

    const requestId = store.requests[0]!.id;
    await s.service.declineJoinRequest(s.discordGuild, requestId, A);
    await s.service.declineJoinRequest(s.discordGuild, requestId, B);

    await expect(s.service.requestToJoin(s.discordGuild, C, s.squad.id)).rejects.toMatchObject({
      code: 'REQUEST_COOLDOWN',
    });
    expect(await s.service.listJoinableSquads(GUILD_ID, C, s.game.id)).toEqual([]);
  });

  it('quem já é membro não pede, e squad cheio recusa', async () => {
    const s = squadScenario({ size: 2 });
    seedProfile({ userId: C, gameId: s.game.id, availability: saturdayNight });

    await expect(s.service.requestToJoin(s.discordGuild, A, s.squad.id)).rejects.toMatchObject({
      code: 'ALREADY_MEMBER',
    });
    await expect(s.service.requestToJoin(s.discordGuild, C, s.squad.id)).rejects.toMatchObject({
      code: 'SQUAD_FULL',
    });
    expect(store.requests).toHaveLength(0);
  });
});
