import { SquadsConfigSchema } from '@goodbot/shared';
import { ChannelType } from 'discord.js';
import { vi } from 'vitest';

import type { SquadsConfig } from '@goodbot/shared';
import type { Client, Guild, GuildMember, VoiceState } from 'discord.js';

export const GUILD = '100000000000000001';
export const SEARCH = '200000000000000001';
export const OPT_OUT = '200000000000000002';
export const CATEGORY = '300000000000000001';
export const CREATE = '300000000000000002';
export const PANEL = '300000000000000003';
export const LOBBY = '300000000000000004';
export const AGENDA = '300000000000000005';
export const ALICE = '400000000000000001';
export const BOB = '400000000000000002';

export function squadsConfig(overrides: Partial<SquadsConfig> = {}): SquadsConfig {
  return SquadsConfigSchema.parse({
    enabled: true,
    searchRoleId: SEARCH,
    optOutRoleId: OPT_OUT,
    categoryId: CATEGORY,
    createChannelId: CREATE,
    panelChannelId: PANEL,
    agendaChannelId: AGENDA,
    ...overrides,
  });
}

export interface FakeChannel {
  id: string;
  type: ChannelType;
  name: string;
  parentId: string | null;
  userLimit: number;
  permissionsFor: () => { has: (flag: bigint) => boolean };
  delete: ReturnType<typeof vi.fn>;
  permissionOverwrites: { edit: ReturnType<typeof vi.fn> };
  toString: () => string;
}

/**
 * Guild mínima para as salas: canais (com criar e apagar que mexem no cache),
 * quem está em voz e as permissões do bot, iguais em todo canal.
 */
export function fakeRoomGuild() {
  const channels = new Map<string, FakeChannel>();
  const voice = new Map<string, { channelId: string | null }>();
  const denied = new Set<bigint>();
  let nextId = 500000000000000001n;

  const guild = {
    id: GUILD,
    name: 'Goodivers',
    channels: {
      cache: channels,
      create: vi.fn(
        (options: { name: string; type: ChannelType; parent: string; userLimit: number }) =>
          Promise.resolve(
            addChannel({
              id: String(nextId++),
              type: options.type,
              name: options.name,
              parentId: options.parent,
              userLimit: options.userLimit,
            }),
          ),
      ),
    },
    voiceStates: { cache: voice },
    roles: { cache: new Map() },
    afkChannelId: null,
    members: { me: { id: 'bot' } },
  } as unknown as Guild;

  function addChannel(
    input: Pick<FakeChannel, 'id' | 'type' | 'name' | 'parentId'> & { userLimit?: number },
  ): FakeChannel {
    const channel: FakeChannel = {
      userLimit: 0,
      ...input,
      permissionsFor: () => ({ has: (flag: bigint) => !denied.has(flag) }),
      delete: vi.fn(() => {
        channels.delete(input.id);
        return Promise.resolve();
      }),
      permissionOverwrites: { edit: vi.fn(() => Promise.resolve()) },
      toString: () => `<#${input.id}>`,
    };
    channels.set(channel.id, channel);
    return channel;
  }

  addChannel({
    id: CATEGORY,
    type: ChannelType.GuildCategory,
    name: 'Buscar Squad',
    parentId: null,
  });
  addChannel({
    id: CREATE,
    type: ChannelType.GuildVoice,
    name: '➕ Criar Squad',
    parentId: CATEGORY,
  });
  addChannel({ id: LOBBY, type: ChannelType.GuildVoice, name: 'Geral', parentId: null });

  /** Põe alguém num canal de voz (ou tira, com `null`), como o gateway faria. */
  function setVoice(userId: string, channelId: string | null): void {
    voice.set(userId, { channelId });
  }

  function member(id: string, options: { bot?: boolean; moveFails?: boolean } = {}): GuildMember {
    return {
      id,
      user: { id, bot: options.bot ?? false },
      voice: {
        setChannel: vi.fn((channel: { id: string }) => {
          if (options.moveFails) return Promise.reject(new Error('Target user is not connected'));
          setVoice(id, channel.id);
          return Promise.resolve();
        }),
      },
    } as unknown as GuildMember;
  }

  const client = { guilds: { cache: new Map([[GUILD, guild]]) } } as unknown as Client;
  return { guild, client, channels, voice, denied, addChannel, setVoice, member };
}

export function voiceState(
  guild: Guild,
  id: string,
  channelId: string | null,
  member: GuildMember | null = null,
): VoiceState {
  return { id, guild, channelId, member } as unknown as VoiceState;
}
