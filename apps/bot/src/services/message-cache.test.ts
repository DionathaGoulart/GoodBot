import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@goodbot/db';
import type { Message } from 'discord.js';

const { cacheMessages, getCachedMessages, deleteCachedMessagesBefore } = vi.hoisted(() => ({
  cacheMessages: vi.fn(),
  getCachedMessages: vi.fn(),
  deleteCachedMessagesBefore: vi.fn(),
}));

vi.mock('@goodbot/db', () => ({ cacheMessages, getCachedMessages, deleteCachedMessagesBefore }));

const { IDLE_CHANNEL_MS, MessageCacheService } = await import('./message-cache');

const GUILD_A = '900000000000000001';
const GUILD_B = '900000000000000002';
const CANAL_A = '910000000000000001';
const CANAL_B = '910000000000000002';
const AUTOR = '700000000000000000';

let agora = 0;
let proximoId = 1;

function mensagem(guildId: string, channelId: string, content = 'oi'): Message {
  const id = String(800000000000000000n + BigInt(proximoId++));
  return {
    id,
    guildId,
    channelId,
    content,
    author: { id: AUTOR, bot: false },
    attachments: new Map(),
    createdAt: new Date(agora),
  } as unknown as Message;
}

function servico() {
  // Buffer grande: estes testes são sobre a memória, não sobre o lote no banco.
  return new MessageCacheService({ db: {} as Db, bufferSize: 10_000, now: () => agora });
}

beforeEach(() => {
  vi.clearAllMocks();
  getCachedMessages.mockResolvedValue([]);
  agora = Date.UTC(2026, 8, 16, 12);
  proximoId = 1;
});

describe('MessageCacheService', () => {
  it('cada canal guarda até o perChannel da própria guild', async () => {
    const cache = servico();
    const deA = Array.from({ length: 30 }, () => mensagem(GUILD_A, CANAL_A));
    const deB = Array.from({ length: 30 }, () => mensagem(GUILD_B, CANAL_B));

    for (const m of deA) cache.record(m, 1000);
    for (const m of deB) cache.record(m, 10);

    // Guild A pediu 1000: as 30 continuam na memória.
    expect(await cache.get(CANAL_A, deA[0]!.id)).not.toBeNull();
    // Guild B pediu 10: o pedido de A não aumenta o cache dela.
    const primeirasDeB = await cache.getMany(
      CANAL_B,
      deB.slice(0, 20).map((m) => m.id),
    );
    expect(primeirasDeB).toEqual([]);
    const ultimasDeB = await cache.getMany(
      CANAL_B,
      deB.slice(20).map((m) => m.id),
    );
    expect(ultimasDeB).toHaveLength(10);
  });

  it('baixar o perChannel encolhe o canal na mensagem seguinte', async () => {
    const cache = servico();
    const antigas = Array.from({ length: 50 }, () => mensagem(GUILD_A, CANAL_A));
    for (const m of antigas) cache.record(m, 200);

    const nova = mensagem(GUILD_A, CANAL_A);
    cache.record(nova, 10);

    expect(
      await cache.getMany(
        CANAL_A,
        antigas.slice(0, 41).map((m) => m.id),
      ),
    ).toEqual([]);
    expect(await cache.get(CANAL_A, nova.id)).not.toBeNull();
  });

  it('canal parado há mais de uma hora sai da memória e o resto fica', async () => {
    const cache = servico();
    const parada = mensagem(GUILD_A, CANAL_A);
    cache.record(parada, 200);

    agora += IDLE_CHANNEL_MS / 2;
    cache.record(mensagem(GUILD_B, CANAL_B), 200);

    agora += IDLE_CHANNEL_MS / 2;
    expect(cache.sweep()).toBe(1);
    expect(cache.channelsInMemory).toBe(1);

    // O conteúdo do canal varrido continua acessível pelo banco.
    const doBanco = { ...parada, messageId: parada.id, attachments: [] };
    getCachedMessages.mockResolvedValueOnce([doBanco]);
    expect((await cache.get(CANAL_A, parada.id))?.content).toBe('oi');
    expect(getCachedMessages).toHaveBeenCalledWith({}, [parada.id]);
  });

  it('mensagem nova adia a varredura do canal', () => {
    const cache = servico();
    cache.record(mensagem(GUILD_A, CANAL_A), 200);

    agora += IDLE_CHANNEL_MS - 1;
    cache.record(mensagem(GUILD_A, CANAL_A), 200);

    agora += IDLE_CHANNEL_MS - 1;
    expect(cache.sweep()).toBe(0);
    expect(cache.channelsInMemory).toBe(1);
  });

  it('não guarda mensagem de bot nem fora de servidor', () => {
    const cache = servico();
    const doBot = { ...mensagem(GUILD_A, CANAL_A), author: { id: AUTOR, bot: true } };
    const semGuild = { ...mensagem(GUILD_A, CANAL_B), guildId: null };

    cache.record(doBot as unknown as Message, 200);
    cache.record(semGuild as unknown as Message, 200);

    expect(cache.channelsInMemory).toBe(0);
    expect(cache.pendingSize).toBe(0);
  });
});
