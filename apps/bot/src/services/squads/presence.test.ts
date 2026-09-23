import { MINUTE_MS, SquadsConfigSchema } from '@goodbot/shared';
import { ActivityType, Collection } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import {
  DeadlineBook,
  matchesGame,
  PRESENCE_RECHECK_MS,
  PROMPT_COOLDOWN_MS,
  PromptGate,
  SquadPresenceService,
} from './presence';

import type { SquadsConfig } from '@goodbot/shared';
import type { Client, Guild, GuildMember, Presence, VoiceState } from 'discord.js';

const GUILD = '100000000000000001';
const SEARCH = '200000000000000001';
const OPT_OUT = '200000000000000002';
const CATEGORY = '300000000000000001';
const CREATE = '300000000000000002';
const ROOM = '300000000000000003';
const LOBBY = '300000000000000004';
const ALICE = '400000000000000001';
const BOB = '400000000000000002';

function squadsConfig(overrides: Partial<SquadsConfig> = {}): SquadsConfig {
  return SquadsConfigSchema.parse({
    enabled: true,
    searchRoleId: SEARCH,
    optOutRoleId: OPT_OUT,
    categoryId: CATEGORY,
    createChannelId: CREATE,
    ...overrides,
  });
}

interface FakeMember {
  id: string;
  guild: Guild;
  user: { id: string; bot: boolean };
  roles: {
    cache: Map<string, unknown>;
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  send: ReturnType<typeof vi.fn>;
}

/** Guild mínima: cargos, canais, quem está em voz e os membros por id. */
function fakeGuild(options: { botPosition?: number } = {}) {
  const voice = new Map<string, { channelId: string }>();
  const members = new Map<string, FakeMember>();
  const roles = new Map([
    [SEARCH, { id: SEARCH, position: 5, managed: false, toString: () => `<@&${SEARCH}>` }],
    [OPT_OUT, { id: OPT_OUT, position: 5, managed: false, toString: () => `<@&${OPT_OUT}>` }],
  ]);
  const channels = new Map([
    [ROOM, { id: ROOM, parentId: CATEGORY }],
    [CREATE, { id: CREATE, parentId: CATEGORY }],
    [LOBBY, { id: LOBBY, parentId: null }],
  ]);
  const guild = {
    id: GUILD,
    name: 'Goodivers',
    roles: { cache: roles },
    channels: { cache: channels },
    voiceStates: { cache: voice },
    members: {
      me: {
        permissions: { has: () => true },
        roles: { highest: { position: options.botPosition ?? 10 } },
      },
      fetch: vi.fn(({ user }: { user: string }) => {
        const member = members.get(user);
        return member ? Promise.resolve(member) : Promise.reject(new Error('Unknown Member'));
      }),
      list: vi.fn(() => Promise.resolve(new Collection([...members].map(([id, m]) => [id, m])))),
    },
  } as unknown as Guild;

  function addMember(id: string, roleIds: string[] = []): FakeMember {
    const cache = new Map<string, unknown>(roleIds.map((roleId) => [roleId, {}]));
    const member: FakeMember = {
      id,
      guild,
      user: { id, bot: false },
      roles: {
        cache,
        add: vi.fn((role: { id: string }) => {
          cache.set(role.id, {});
          return Promise.resolve();
        }),
        remove: vi.fn((role: { id: string }) => {
          cache.delete(role.id);
          return Promise.resolve();
        }),
      },
      send: vi.fn(() => Promise.resolve()),
    };
    members.set(id, member);
    return member;
  }

  return { guild, voice, addMember };
}

function setup(config = squadsConfig(), guildOptions: { botPosition?: number } = {}) {
  const fake = fakeGuild(guildOptions);
  let now = 1_000_000;
  const client = { guilds: { cache: new Map([[GUILD, fake.guild]]) } } as unknown as Client;
  const service = new SquadPresenceService({
    client,
    config: { get: () => Promise.resolve(config) } as never,
    registry: { servedGuildIds: () => [GUILD] },
    now: () => now,
  });
  return {
    ...fake,
    service,
    config,
    advance: (ms: number) => {
      now += ms;
    },
    at: () => now,
  };
}

function voiceState(guild: Guild, id: string, channelId: string | null, member?: FakeMember) {
  return { id, guild, channelId, member: member ?? null } as unknown as VoiceState;
}

function presence(guild: Guild, userId: string, name: string, type = ActivityType.Playing) {
  return {
    guild,
    userId,
    user: { bot: false },
    activities: [{ type, name }],
  } as unknown as Presence;
}

describe('matchesGame', () => {
  it('casa sem ™ e sem diferenciar caixa', () => {
    expect(
      matchesGame([{ type: ActivityType.Playing, name: 'HELLDIVERS™ 2' }], ['helldivers 2']),
    ).toBe(true);
  });

  it('só vale jogando: status personalizado com o nome não conta', () => {
    expect(
      matchesGame([{ type: ActivityType.Custom, name: 'Helldivers 2' }], ['HELLDIVERS™ 2']),
    ).toBe(false);
  });

  it('lista vazia desliga o aviso', () => {
    expect(matchesGame([{ type: ActivityType.Playing, name: 'HELLDIVERS™ 2' }], [])).toBe(false);
  });
});

describe('DeadlineBook', () => {
  it('entrega só o que venceu e tira do livro', () => {
    const book = new DeadlineBook();
    book.set('g', 'a', { at: 10, kind: 'ttl' });
    book.set('g', 'b', { at: 20, kind: 'left' });
    expect(book.takeDue(15).map((d) => d.id)).toEqual(['a']);
    expect(book.size).toBe(1);
    expect(book.takeDue(15)).toEqual([]);
  });

  it('um prazo novo substitui o anterior da mesma pessoa', () => {
    const book = new DeadlineBook();
    book.set('g', 'a', { at: 10, kind: 'ttl' });
    book.set('g', 'a', { at: 50, kind: 'left' });
    expect(book.takeDue(20)).toEqual([]);
    expect(book.get('g', 'a')).toEqual({ at: 50, kind: 'left' });
  });
});

describe('PromptGate', () => {
  it('olha uma vez a cada 5 min e cala 6 h depois do aviso', () => {
    const gate = new PromptGate();
    expect(gate.shouldCheck('g', 'a', 0)).toBe(true);
    expect(gate.shouldCheck('g', 'a', PRESENCE_RECHECK_MS - 1)).toBe(false);
    expect(gate.shouldCheck('g', 'a', PRESENCE_RECHECK_MS)).toBe(true);
    gate.markPrompted('g', 'a', PRESENCE_RECHECK_MS);
    expect(gate.shouldCheck('g', 'a', PRESENCE_RECHECK_MS * 3)).toBe(false);
    expect(gate.shouldCheck('g', 'a', PRESENCE_RECHECK_MS + PROMPT_COOLDOWN_MS)).toBe(true);
  });

  it('é por guild', () => {
    const gate = new PromptGate();
    gate.markPrompted('g1', 'a', 0);
    expect(gate.shouldCheck('g2', 'a', 1)).toBe(true);
  });
});

describe('SquadPresenceService: aviso automático', () => {
  it('manda a DM com os três botões a quem abre o jogo', async () => {
    const { guild, addMember, service } = setup();
    const alice = addMember(ALICE);
    await service.onPresence(presence(guild, ALICE, 'HELLDIVERS™ 2'));
    expect(alice.send).toHaveBeenCalledTimes(1);
    const [message] = alice.send.mock.calls[0] as [{ components: { components: unknown[] }[] }];
    expect(message.components[0]?.components).toHaveLength(3);
  });

  it('não repete dentro do cooldown, nem com DM fechada', async () => {
    const { guild, addMember, service, advance } = setup();
    const alice = addMember(ALICE);
    alice.send.mockRejectedValue(new Error('Cannot send messages to this user'));
    await service.onPresence(presence(guild, ALICE, 'HELLDIVERS™ 2'));
    advance(PRESENCE_RECHECK_MS * 2);
    await service.onPresence(presence(guild, ALICE, 'HELLDIVERS™ 2'));
    expect(alice.send).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['já busca', [SEARCH], null],
    ['tem Sem Aviso', [OPT_OUT], null],
    ['está numa sala do módulo', [], ROOM],
    ['está no canal de criar', [], CREATE],
  ])('pula quem %s', async (_label, roleIds, channelId) => {
    const { guild, addMember, voice, service } = setup();
    const alice = addMember(ALICE, roleIds);
    if (channelId) voice.set(ALICE, { channelId });
    await service.onPresence(presence(guild, ALICE, 'HELLDIVERS™ 2'));
    expect(alice.send).not.toHaveBeenCalled();
  });

  it('ignora outro jogo e módulo desligado', async () => {
    const off = setup(squadsConfig({ enabled: false }));
    const bob = off.addMember(BOB);
    await off.service.onPresence(presence(off.guild, BOB, 'HELLDIVERS™ 2'));
    const on = setup();
    const alice = on.addMember(ALICE);
    await on.service.onPresence(presence(on.guild, ALICE, 'Minecraft'));
    expect(bob.send).not.toHaveBeenCalled();
    expect(alice.send).not.toHaveBeenCalled();
  });
});

describe('SquadPresenceService: toggles', () => {
  it('liga com prazo de TTL fora da voz e desliga no segundo clique', async () => {
    const { addMember, service, config, at } = setup();
    const alice = addMember(ALICE);
    expect(await service.toggleSearch(alice as unknown as GuildMember, config)).toBe('on');
    expect(alice.roles.cache.has(SEARCH)).toBe(true);
    expect(service.deadlines.get(GUILD, ALICE)).toEqual({
      at: at() + config.searchTtlMinutes * MINUTE_MS,
      kind: 'ttl',
    });
    expect(await service.toggleSearch(alice as unknown as GuildMember, config)).toBe('off');
    expect(alice.roles.cache.has(SEARCH)).toBe(false);
    expect(service.deadlines.get(GUILD, ALICE)).toBeUndefined();
  });

  it('quem já está em voz liga sem prazo', async () => {
    const { addMember, voice, service, config } = setup();
    const alice = addMember(ALICE);
    voice.set(ALICE, { channelId: LOBBY });
    await service.toggleSearch(alice as unknown as GuildMember, config);
    expect(service.deadlines.get(GUILD, ALICE)).toBeUndefined();
  });

  it('cargo acima do bot vira erro que diz o que fazer', async () => {
    const { addMember, service, config } = setup(squadsConfig(), { botPosition: 3 });
    const alice = addMember(ALICE);
    await expect(
      service.toggleSearch(alice as unknown as GuildMember, config),
    ).rejects.toMatchObject({
      code: 'BOT_ROLE_HIERARCHY',
    });
  });

  it('sem cargo configurado, erro em vez de silêncio', async () => {
    const { addMember, service } = setup(squadsConfig({ optOutRoleId: null }));
    const alice = addMember(ALICE);
    await expect(
      service.toggleOptOut(alice as unknown as GuildMember, squadsConfig({ optOutRoleId: null })),
    ).rejects.toMatchObject({ code: 'SQUADS_ROLE_MISSING' });
  });
});

describe('SquadPresenceService: prazos', () => {
  it('ligou e não entrou em voz no TTL: o cargo cai', async () => {
    const { addMember, service, config, advance } = setup();
    const alice = addMember(ALICE);
    await service.startSearch(alice as unknown as GuildMember, config);
    advance(config.searchTtlMinutes * MINUTE_MS - 1);
    await service.tick();
    expect(alice.roles.cache.has(SEARCH)).toBe(true);
    advance(1);
    await service.tick();
    expect(alice.roles.cache.has(SEARCH)).toBe(false);
  });

  it('entrar em voz cancela o TTL; sair abre a janela e ela tira o cargo', async () => {
    const { guild, addMember, voice, service, config, advance } = setup();
    const alice = addMember(ALICE);
    await service.startSearch(alice as unknown as GuildMember, config);
    voice.set(ALICE, { channelId: ROOM });
    await service.onVoiceState(voiceState(guild, ALICE, null), voiceState(guild, ALICE, ROOM));
    expect(service.deadlines.get(GUILD, ALICE)).toBeUndefined();

    voice.delete(ALICE);
    await service.onVoiceState(
      voiceState(guild, ALICE, ROOM, alice),
      voiceState(guild, ALICE, null, alice),
    );
    advance(config.graceMinutes * MINUTE_MS - 1);
    await service.tick();
    expect(alice.roles.cache.has(SEARCH)).toBe(true);
    advance(1);
    await service.tick();
    expect(alice.roles.cache.has(SEARCH)).toBe(false);
  });

  it('voltar dentro da janela mantém o cargo', async () => {
    const { guild, addMember, voice, service, config, advance } = setup();
    const alice = addMember(ALICE, [SEARCH]);
    await service.onVoiceState(
      voiceState(guild, ALICE, ROOM, alice),
      voiceState(guild, ALICE, null, alice),
    );
    advance(MINUTE_MS);
    voice.set(ALICE, { channelId: ROOM });
    await service.onVoiceState(voiceState(guild, ALICE, null), voiceState(guild, ALICE, ROOM));
    advance(config.graceMinutes * MINUTE_MS);
    await service.tick();
    expect(alice.roles.cache.has(SEARCH)).toBe(true);
  });

  it('trocar de canal não abre janela; sair sem o cargo também não', async () => {
    const { guild, addMember, service } = setup();
    const alice = addMember(ALICE, [SEARCH]);
    const bob = addMember(BOB);
    await service.onVoiceState(
      voiceState(guild, ALICE, ROOM, alice),
      voiceState(guild, ALICE, LOBBY, alice),
    );
    await service.onVoiceState(
      voiceState(guild, BOB, ROOM, bob),
      voiceState(guild, BOB, null, bob),
    );
    expect(service.deadlines.size).toBe(0);
  });

  it('janela 0: o cargo cai na hora', async () => {
    const { guild, addMember, service } = setup(squadsConfig({ graceMinutes: 0 }));
    const alice = addMember(ALICE, [SEARCH]);
    await service.onVoiceState(
      voiceState(guild, ALICE, ROOM, alice),
      voiceState(guild, ALICE, null, alice),
    );
    expect(alice.roles.cache.has(SEARCH)).toBe(false);
  });

  it('módulo desligado quando o prazo vence: o cargo fica', async () => {
    const config = squadsConfig();
    const { addMember, service, advance } = setup(config);
    const alice = addMember(ALICE);
    await service.startSearch(alice as unknown as GuildMember, config);
    config.enabled = false;
    advance(config.searchTtlMinutes * MINUTE_MS);
    await service.tick();
    expect(alice.roles.cache.has(SEARCH)).toBe(true);
  });
});

describe('SquadPresenceService: reconciliação', () => {
  it('no primeiro tick, quem tem o cargo fora da voz ganha a janela do zero', async () => {
    const { addMember, voice, service, config, at, advance } = setup();
    const alice = addMember(ALICE, [SEARCH]);
    const bob = addMember(BOB, [SEARCH]);
    voice.set(BOB, { channelId: ROOM });
    await service.tick();
    expect(service.deadlines.get(GUILD, ALICE)).toEqual({
      at: at() + config.graceMinutes * MINUTE_MS,
      kind: 'left',
    });
    expect(service.deadlines.get(GUILD, BOB)).toBeUndefined();

    advance(config.graceMinutes * MINUTE_MS);
    await service.tick();
    expect(alice.roles.cache.has(SEARCH)).toBe(false);
    expect(bob.roles.cache.has(SEARCH)).toBe(true);
  });

  it('só reconcilia uma vez enquanto o módulo segue ligado', async () => {
    const { guild, service } = setup();
    await service.tick();
    await service.tick();
    expect(guild.members.list).toHaveBeenCalledTimes(1);
  });

  it('desligar e ligar de novo reconcilia outra vez', async () => {
    const config = squadsConfig();
    const { guild, service } = setup(config);
    await service.tick();
    config.enabled = false;
    await service.tick();
    config.enabled = true;
    await service.tick();
    expect(guild.members.list).toHaveBeenCalledTimes(2);
  });
});
