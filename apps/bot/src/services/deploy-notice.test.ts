import { MINUTE_MS } from '@goodbot/shared';
import { Collection } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DeployNoticeService } from './deploy-notice';

import type { DeployNoticeRecord } from '@goodbot/db';
import type { Client } from 'discord.js';

const stored = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@goodbot/db', () => ({
  getDeployNotice: vi.fn(async () => stored.value),
  setDeployNotice: vi.fn(async (_db: unknown, record: unknown) => {
    stored.value = structuredClone(record);
  }),
  clearDeployNotice: vi.fn(async () => {
    stored.value = null;
  }),
}));

const NOW = Date.parse('2026-09-22T12:00:00Z');
const GUILD_A = '200000000000000002';
const GUILD_B = '300000000000000003';
const GUILD_C = '400000000000000004';

let nextId = 0;

/** Guild o bastante para `noticeChannel`: canal de sistema onde o bot escreve (ou não). */
function fakeGuild(id: string, options: { canSend?: boolean; failSend?: boolean } = {}) {
  const channel = {
    id: `${id}-canal`,
    type: 0,
    rawPosition: 0,
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => options.canSend ?? true }),
    send: vi.fn(async (_payload: { embeds: { toJSON(): unknown }[] }) => {
      if (options.failSend) throw new Error('Missing Access');
      nextId++;
      return { id: `${id}-msg-${String(nextId)}` };
    }),
    messages: {
      edit: vi.fn(async (_id: string, _payload: { embeds: { toJSON(): unknown }[] }) => ({})),
    },
  };
  const guild = {
    id,
    systemChannel: channel,
    members: { me: { id: 'bot' } },
    channels: { cache: new Collection([[channel.id, channel]]) },
  };
  Object.assign(channel, { guild });
  return { guild, channel };
}

function setup(served: string[] = [GUILD_A, GUILD_B]) {
  const a = fakeGuild(GUILD_A);
  const b = fakeGuild(GUILD_B, { canSend: false });
  const c = fakeGuild(GUILD_C, { failSend: true });
  const channels = new Map([a, b, c].map(({ channel }) => [channel.id, channel]));
  const client = {
    guilds: {
      cache: new Collection([a, b, c].map(({ guild }) => [guild.id, guild] as const)),
    },
    channels: {
      fetch: vi.fn(async (id: string) => {
        const channel = channels.get(id);
        if (!channel) throw new Error('Unknown Channel');
        return channel;
      }),
    },
  } as unknown as Client;
  const clock = { now: NOW };
  const service = new DeployNoticeService({
    client,
    db: {} as never,
    registry: { servedGuildIds: () => served },
    now: () => clock.now,
  });
  return { service, clock, a, b, c };
}

const record = () => stored.value as DeployNoticeRecord;

describe('DeployNoticeService', () => {
  beforeEach(() => {
    stored.value = null;
    vi.clearAllMocks();
  });

  it('avisa cada servidor atendido com a previsão do tipo e grava as mensagens', async () => {
    const s = setup([GUILD_A, GUILD_B, GUILD_C, '500000000000000005']);

    const result = await s.service.announce('database');

    // B não tem onde falar e C falha no envio; o 5º nem está no cache.
    expect(result).toEqual({
      kind: 'database',
      expectedAt: new Date(NOW + 2 * MINUTE_MS).toISOString(),
      total: 3,
      delivered: 1,
    });
    const payload = s.a.channel.send.mock.calls[0]?.[0];
    expect(payload?.embeds[0]?.toJSON()).toMatchObject({
      title: '> MANUTENÇÃO: ATUALIZAÇÃO DO BANCO',
      description: expect.stringContaining(`<t:${String((NOW + 2 * MINUTE_MS) / 1000)}:R>`),
    });
    expect(record()).toEqual({
      kind: 'database',
      startedAt: new Date(NOW).toISOString(),
      expectedAt: new Date(NOW + 2 * MINUTE_MS).toISOString(),
      messages: [{ guildId: GUILD_A, channelId: s.a.channel.id, messageId: expect.any(String) }],
    });
  });

  it('um aviso que não chegou a reiniciar soma as mensagens ao seguinte', async () => {
    const s = setup([GUILD_A]);
    await s.service.announce('restart');
    s.clock.now += 10 * MINUTE_MS;

    await s.service.announce('infra');

    expect(record()).toMatchObject({
      kind: 'infra',
      startedAt: new Date(NOW + 10 * MINUTE_MS).toISOString(),
    });
    expect(record().messages).toHaveLength(2);
  });

  it('no boot troca os avisos por "voltou", com o tempo fora, e apaga a chave', async () => {
    const s = setup([GUILD_A]);
    await s.service.announce('restart');
    const messageId = record().messages[0]?.messageId;
    s.clock.now += 3 * MINUTE_MS;

    expect(await s.service.resolve()).toBe(1);

    const [id, payload] = s.a.channel.messages.edit.mock.calls[0] ?? [];
    expect(id).toBe(messageId);
    expect(payload?.embeds[0]?.toJSON()).toMatchObject({
      title: '> GOODBOT DE VOLTA',
      description: expect.stringContaining('Ficou fora por 3 min.'),
    });
    expect(stored.value).toBeNull();
    expect(await s.service.resolve()).toBe(0);
  });

  it('canal sumido não impede os outros, e a chave sai do mesmo jeito', async () => {
    const s = setup([GUILD_A]);
    stored.value = {
      kind: 'restart',
      startedAt: new Date(NOW).toISOString(),
      expectedAt: new Date(NOW + MINUTE_MS).toISOString(),
      messages: [
        { guildId: GUILD_C, channelId: '999', messageId: '1' },
        { guildId: GUILD_A, channelId: s.a.channel.id, messageId: '2' },
      ],
    };
    s.clock.now += 20 * 1000;

    expect(await s.service.resolve()).toBe(1);
    expect(s.a.channel.messages.edit).toHaveBeenCalledWith('2', expect.anything());
    const payload = s.a.channel.messages.edit.mock.calls[0]?.[1];
    expect(payload?.embeds[0]?.toJSON()).toMatchObject({
      description: expect.stringContaining('menos de 1 min'),
    });
    expect(stored.value).toBeNull();
  });
});
