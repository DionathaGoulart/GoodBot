import {
  ChannelType,
  Collection,
  OverwriteType,
  PermissionFlagsBits,
  PermissionsBitField,
} from 'discord.js';
import { vi } from 'vitest';

import { GUILD_ID } from './fake-db';

import type { ExactOverwrite } from '../../../lib/overwrites';
import type { APIEmbed, EmbedBuilder } from 'discord.js';

/**
 * Objetos do Discord só com o que o módulo `squads` usa. Cada escrita (`set`,
 * `edit`, `delete`, `send`) muda o estado do fake, para os testes lerem o
 * canal depois como leriam no Discord.
 */

export const BOT_ID = '100000000000000000';

let seq = 0n;
export const snowflake = (): string => String(600000000000000000n + ++seq);

interface CachedOverwrite {
  id: string;
  type: OverwriteType;
  allow: { bitfield: bigint };
  deny: { bitfield: bigint };
}

const toEntry = (overwrite: {
  id: string;
  type?: OverwriteType;
  allow?: bigint;
  deny?: bigint;
}): CachedOverwrite => ({
  id: overwrite.id,
  type: overwrite.type ?? OverwriteType.Member,
  allow: { bitfield: overwrite.allow ?? 0n },
  deny: { bitfield: overwrite.deny ?? 0n },
});

export function fakeOverwriteManager(initial: readonly ExactOverwrite[] = []) {
  const manager = {
    cache: new Collection<string, CachedOverwrite>(initial.map((o) => [o.id, toEntry(o)])),
    set: vi.fn(async (list: readonly ExactOverwrite[], _reason?: string) => {
      manager.cache = new Collection(list.map((o) => [o.id, toEntry(o)]));
    }),
    edit: vi.fn(
      async (
        id: string,
        options: Record<string, boolean | null>,
        extra?: { type?: OverwriteType; reason?: string },
      ) => {
        const current = manager.cache.get(id) ?? toEntry({ id, type: extra?.type });
        let allow = current.allow.bitfield;
        let deny = current.deny.bitfield;
        for (const [key, value] of Object.entries(options)) {
          const bit = PermissionFlagsBits[key as keyof typeof PermissionFlagsBits];
          allow &= ~bit;
          deny &= ~bit;
          if (value === true) allow |= bit;
          else if (value === false) deny |= bit;
        }
        manager.cache.set(id, toEntry({ id, type: current.type, allow, deny }));
      },
    ),
    delete: vi.fn(async (id: string, _reason?: string) => {
      manager.cache.delete(id);
    }),
  };
  return manager;
}

export function overwritesOf(manager: ReturnType<typeof fakeOverwriteManager>): ExactOverwrite[] {
  return manager.cache.map((o) => ({
    id: o.id,
    type: o.type,
    allow: o.allow.bitfield,
    deny: o.deny.bitfield,
  }));
}

export interface FakeMessage {
  id: string;
  payload: Record<string, unknown>;
  edit: ReturnType<typeof vi.fn>;
}

/** Primeiro embed de uma mensagem, já como JSON. */
export function embedOf(message: FakeMessage | undefined): APIEmbed | undefined {
  const embeds = message?.payload.embeds as EmbedBuilder[] | undefined;
  return embeds?.[0]?.toJSON();
}

export function componentsOf(message: FakeMessage | undefined): unknown[] {
  return (message?.payload.components as unknown[] | undefined) ?? [];
}

function fakeMessages() {
  const sent: FakeMessage[] = [];
  const send = vi.fn(async (payload: Record<string, unknown>) => {
    const message: FakeMessage = {
      id: snowflake(),
      payload,
      edit: vi.fn(async (next: Record<string, unknown>) => {
        message.payload = { ...message.payload, ...next };
        return message;
      }),
    };
    sent.push(message);
    return message;
  });
  const messages = {
    fetch: vi.fn(async (id: string) => {
      const found = sent.find((message) => message.id === id);
      if (!found) throw new Error('Unknown Message');
      return found;
    }),
  };
  return { sent, send, messages };
}

export function fakeTextChannel(
  options: { id?: string; name?: string; overwrites?: readonly ExactOverwrite[] } = {},
) {
  const channel = {
    id: options.id ?? snowflake(),
    name: options.name ?? 'canal',
    type: ChannelType.GuildText as const,
    isThread: () => false,
    isTextBased: () => true,
    permissionOverwrites: fakeOverwriteManager(options.overwrites),
    ...fakeMessages(),
    setName: vi.fn(async (name: string, _reason?: string) => {
      channel.name = name;
      return channel;
    }),
  };
  return channel;
}
export type FakeTextChannel = ReturnType<typeof fakeTextChannel>;

export function fakeThread() {
  const thread = {
    id: snowflake(),
    type: ChannelType.PrivateThread as const,
    archived: false,
    locked: false,
    isThread: () => true,
    members: { add: vi.fn(async (_userId: string) => undefined) },
    ...fakeMessages(),
    edit: vi.fn(async (options: { archived?: boolean; locked?: boolean }) => {
      if (options.archived !== undefined) thread.archived = options.archived;
      if (options.locked !== undefined) thread.locked = options.locked;
      return thread;
    }),
    delete: vi.fn(async (_reason?: string) => undefined),
  };
  return thread;
}
export type FakeThread = ReturnType<typeof fakeThread>;

/** Tudo menos `Administrator`, que faria `has` passar para qualquer bit. */
export const ALL_BUT_ADMIN = PermissionsBitField.All & ~PermissionFlagsBits.Administrator;

export function fakeVoice(
  options: { permissions?: bigint; overwrites?: readonly ExactOverwrite[] } = {},
) {
  return {
    id: snowflake(),
    type: ChannelType.GuildVoice as const,
    isThread: () => false,
    permissionsFor: vi.fn(() => new PermissionsBitField(options.permissions ?? ALL_BUT_ADMIN)),
    permissionOverwrites: fakeOverwriteManager(options.overwrites),
    /** Quem está conectado agora. */
    members: new Collection<string, { id: string; user: { bot: boolean } }>(),
  };
}
export type FakeVoice = ReturnType<typeof fakeVoice>;

export function fakeCategory() {
  return { id: snowflake(), type: ChannelType.GuildCategory as const, isThread: () => false };
}

interface FakeVoiceState {
  channelId: string | null;
  setChannel: ReturnType<typeof vi.fn>;
}

/** Erro com o `code` numérico de um `DiscordAPIError`, que é o que o módulo lê. */
export function discordError(message: string, code: number, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

export function fakeGuild() {
  const cache = new Collection<string, { id: string }>();
  const voiceStates = new Collection<string, FakeVoiceState>();
  /** Quem `leave` tirou; o resto conta como membro. */
  const left = new Set<string>();
  const guild = {
    id: GUILD_ID,
    name: 'Servidor Teste',
    roles: { everyone: { id: GUILD_ID } },
    members: {
      me: { id: BOT_ID },
      cache: new Collection<string, { id: string }>(),
      fetch: vi.fn(async (options: { user: string | readonly string[] }) => {
        if (typeof options.user !== 'string') {
          return new Collection(
            options.user.filter((id) => !left.has(id)).map((id) => [id, { id }] as const),
          );
        }
        if (left.has(options.user)) throw discordError('Unknown Member', 10007);
        return { id: options.user };
      }),
    },
    /** Tira alguém do servidor: `members.fetch` passa a responder "Unknown Member". */
    leave(userId: string): void {
      left.add(userId);
      guild.members.cache.delete(userId);
    },
    channels: {
      cache,
      fetch: vi.fn(async (id: string) => cache.get(id) ?? null),
      create: vi.fn(
        async (options: {
          name: string;
          type: ChannelType;
          parent?: string | null;
          permissionOverwrites?: readonly ExactOverwrite[];
        }) => {
          const channel = fakeTextChannel({
            name: options.name,
            overwrites: options.permissionOverwrites,
          });
          cache.set(channel.id, channel);
          return channel;
        },
      ),
    },
    voiceStates: { cache: voiceStates },
    add<T extends { id: string }>(channel: T): T {
      cache.set(channel.id, channel);
      return channel;
    },
    putInVoice(userId: string, channelId: string): FakeVoiceState {
      const state: FakeVoiceState = {
        channelId,
        setChannel: vi.fn(async (target: string) => {
          state.channelId = target;
        }),
      };
      voiceStates.set(userId, state);
      return state;
    },
  };
  return guild;
}
export type FakeGuild = ReturnType<typeof fakeGuild>;

/**
 * `client.users` com DM gravada por pessoa. `closeDms` faz o `send` recusar
 * como o Discord recusa DM fechada (50007), levando o corpo da mensagem no
 * erro como o `DiscordAPIError` leva; `unknownUser` faz o `fetch` falhar.
 */
export function fakeUsers() {
  const dms = new Map<string, Record<string, unknown>[]>();
  const closed = new Set<string>();
  const unknown = new Set<string>();
  return {
    fetch: vi.fn(async (userId: string) => {
      if (unknown.has(userId)) throw discordError('Unknown User', 10013);
      return {
        id: userId,
        bot: false,
        send: vi.fn(async (payload: Record<string, unknown>) => {
          if (closed.has(userId)) {
            throw discordError('Cannot send messages to this user', 50007, {
              requestBody: { json: payload },
            });
          }
          dms.set(userId, [...(dms.get(userId) ?? []), payload]);
          return { id: snowflake() };
        }),
      };
    }),
    /** As DMs que a pessoa recebeu, na ordem. */
    dmsOf: (userId: string): Record<string, unknown>[] => dms.get(userId) ?? [],
    closeDms(userId: string): void {
      closed.add(userId);
    },
    unknownUser(userId: string): void {
      unknown.add(userId);
    },
  };
}
export type FakeUsers = ReturnType<typeof fakeUsers>;

export function fakeSearchChannel(guild: FakeGuild, permissions: bigint = ALL_BUT_ADMIN) {
  const created: FakeThread[] = [];
  const channel = {
    ...fakeTextChannel(),
    permissionsFor: vi.fn(() => new PermissionsBitField(permissions)),
    threads: {
      created,
      create: vi.fn(async (_options: Record<string, unknown>) => {
        const thread = guild.add(fakeThread());
        created.push(thread);
        return thread;
      }),
    },
  };
  return guild.add(channel);
}
