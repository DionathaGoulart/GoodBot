import { describe, expect, it, vi } from 'vitest';

import { defineEvent } from './event';
import { guildIdOfEvent, loadEvents } from './loader';

import type { BotContext } from './command';
import type { Client, ClientEvents } from 'discord.js';

const ATENDIDA = '100000000000000001';
const PENDENTE = '100000000000000002';

/** Um `Client` de mentira que guarda os listeners por nome de evento. */
function fakeClient() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const client = {
    on: (name: string, listener: (...args: unknown[]) => void) => listeners.set(name, listener),
    once: (name: string, listener: (...args: unknown[]) => void) => listeners.set(name, listener),
  } as unknown as Client;
  return {
    client,
    // O `loadEvents` executa o handler dentro de uma microtarefa (o
    // `Promise.resolve().then` que isola a exceção), então o teste precisa
    // deixar a fila girar antes de checar.
    emit: async (name: string, ...args: unknown[]) => {
      listeners.get(name)?.(...args);
      await Promise.resolve();
    },
  };
}

function fakeCtx(): BotContext {
  return { registry: { serves: (id: string) => id === ATENDIDA } } as unknown as BotContext;
}

describe('guildIdOfEvent', () => {
  it('acha o `guildId` de uma mensagem', () => {
    expect(guildIdOfEvent([{ guildId: ATENDIDA }])).toBe(ATENDIDA);
  });

  it('acha pelo `guild` aninhado quando não há `guildId`', () => {
    expect(guildIdOfEvent([{ guild: { id: ATENDIDA } }])).toBe(ATENDIDA);
  });

  it('devolve nulo para a própria Guild — `guildCreate` não pode ser gateado', () => {
    // Uma `Guild` tem `id`, não `guildId`, e não tem `guild` dentro de si.
    expect(guildIdOfEvent([{ id: ATENDIDA, name: 'Servidor' }])).toBeNull();
  });

  it('devolve nulo para evento sem guild nenhuma (shard, erro)', () => {
    expect(guildIdOfEvent([1, 'texto', null, undefined])).toBeNull();
  });
});

describe('loadEvents', () => {
  const evento = (execute: (...args: never[]) => void, always = false) =>
    defineEvent('messageCreate' as keyof ClientEvents, execute as never, { always });

  it('roda o handler de guild atendida', async () => {
    const execute = vi.fn();
    const { client, emit } = fakeClient();
    loadEvents(client, [evento(execute)], fakeCtx());

    await emit('messageCreate', { guildId: ATENDIDA });

    expect(execute).toHaveBeenCalledOnce();
  });

  it('descarta evento de guild que o bot não atende — nada chega ao banco', async () => {
    const execute = vi.fn();
    const { client, emit } = fakeClient();
    loadEvents(client, [evento(execute)], fakeCtx());

    await emit('messageCreate', { guildId: PENDENTE });

    expect(execute).not.toHaveBeenCalled();
  });

  it('evento marcado `always` roda mesmo em guild não atendida', async () => {
    const execute = vi.fn();
    const { client, emit } = fakeClient();
    loadEvents(client, [evento(execute, true)], fakeCtx());

    await emit('messageCreate', { guildId: PENDENTE });

    expect(execute).toHaveBeenCalledOnce();
  });

  it('evento sem guild (DM, shard, erro) passa', async () => {
    const execute = vi.fn();
    const { client, emit } = fakeClient();
    loadEvents(client, [evento(execute)], fakeCtx());

    await emit('messageCreate', { guildId: null });

    expect(execute).toHaveBeenCalledOnce();
  });
});
