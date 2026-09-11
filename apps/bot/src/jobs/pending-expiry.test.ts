import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GuildRegistryEntry } from '@goodbot/db';
import type { EmbedBuilder } from 'discord.js';
import type { Mock } from 'vitest';

const { listPendingGuildsToExpire, markGuildExpired } = vi.hoisted(() => ({
  listPendingGuildsToExpire: vi.fn(),
  markGuildExpired: vi.fn(),
}));

vi.mock('@goodbot/db', () => ({ listPendingGuildsToExpire, markGuildExpired }));

const { PendingExpiryJob } = await import('./pending-expiry');

const GUILD_ID = '900000000000000000';
const AGORA = new Date('2026-09-10T12:00:00Z');
const PRAZO = 7 * 24 * 60 * 60 * 1000;

function entry(overrides: Partial<GuildRegistryEntry> = {}): GuildRegistryEntry {
  return {
    guildId: GUILD_ID,
    status: 'pending',
    invitedBy: '700000000000000000',
    invitedAt: new Date(AGORA.getTime() - PRAZO - 60_000),
    approvedAt: null,
    expiresAt: null,
    demoWarnedAt: null,
    demoEndedAt: null,
    leftAt: null,
    note: null,
    createdAt: AGORA,
    updatedAt: AGORA,
    ...overrides,
  };
}

function descricaoDo(send: Mock): string {
  const payload = send.mock.calls[0]?.[0] as { embeds: EmbedBuilder[] } | undefined;
  return payload?.embeds[0]?.data.description ?? '';
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const send = vi.fn(() => Promise.resolve({ id: 'msg-1' }));
  const dm = vi.fn(() => Promise.resolve({ id: 'dm-1' }));
  const leave = vi.fn(() => Promise.resolve(undefined));
  const channel = {
    id: '800000000000000000',
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    guild: { members: { me: {} } },
    send,
  };
  const guild = { id: GUILD_ID, name: 'Servidor de teste', systemChannel: channel, leave };
  const cache = { get: vi.fn((_id: string): unknown => guild) };
  const fetchUser = vi.fn(() => Promise.resolve({ bot: false, send: dm }));

  return {
    send,
    dm,
    leave,
    guild,
    cache,
    deps: {
      db: {} as never,
      client: { guilds: { cache }, users: { fetch: fetchUser } } as never,
      urls: { invite: 'https://invite.goodbot.example/', panel: 'https://goodbot.example/' },
      now: () => AGORA.getTime(),
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listPendingGuildsToExpire.mockResolvedValue([]);
  markGuildExpired.mockResolvedValue(null);
});

describe('PendingExpiryJob', () => {
  it('procura os convites mais velhos que o prazo', async () => {
    const { deps } = makeDeps();

    await new PendingExpiryJob({ ...deps, expiryMs: 1_000 }).tick();

    expect(listPendingGuildsToExpire).toHaveBeenCalledWith({}, new Date(AGORA.getTime() - 1_000));
  });

  it('avisa no servidor e no privado, sai e marca — nessa ordem', async () => {
    const { deps, send, dm, leave } = makeDeps();
    listPendingGuildsToExpire.mockResolvedValue([entry()]);

    await new PendingExpiryJob(deps).tick();

    expect(send).toHaveBeenCalledOnce();
    expect(dm).toHaveBeenCalledOnce();
    expect(leave).toHaveBeenCalledOnce();
    // A DM vem antes da saída: depois dela pode não haver mais servidor em
    // comum, e o Discord recusa DM de bot para quem não divide nenhum.
    expect(dm.mock.invocationCallOrder[0]).toBeLessThan(leave.mock.invocationCallOrder[0] ?? 0);
    expect(leave.mock.invocationCallOrder[0]).toBeLessThan(
      markGuildExpired.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('diz que não é bloqueio e que dá para convidar de novo', async () => {
    const { deps, send, dm } = makeDeps();
    listPendingGuildsToExpire.mockResolvedValue([entry()]);

    await new PendingExpiryJob(deps).tick();

    expect(descricaoDo(send)).toContain('não é um bloqueio');
    expect(descricaoDo(send)).toContain('https://invite.goodbot.example/');
    expect(descricaoDo(dm)).toContain('convidar de novo');
  });

  it('guild fora do cache: fecha a linha sem tentar falar nem sair', async () => {
    const { deps, send, leave, cache } = makeDeps();
    listPendingGuildsToExpire.mockResolvedValue([entry()]);
    cache.get.mockReturnValue(undefined);

    await new PendingExpiryJob(deps).tick();

    expect(send).not.toHaveBeenCalled();
    expect(leave).not.toHaveBeenCalled();
    expect(markGuildExpired).toHaveBeenCalledOnce();
  });

  it('marca mesmo quando não consegue sair — insistir de hora em hora só faria ruído', async () => {
    const { deps, cache } = makeDeps();
    listPendingGuildsToExpire.mockResolvedValue([entry()]);
    cache.get.mockReturnValue({
      id: GUILD_ID,
      name: 'Servidor de teste',
      systemChannel: null,
      channels: { cache: new Map() },
      leave: () => Promise.reject(new Error('sem permissão')),
    });

    await expect(new PendingExpiryJob(deps).tick()).resolves.toBeUndefined();
    expect(markGuildExpired).toHaveBeenCalledOnce();
  });

  it('banco fora não derruba a passada', async () => {
    const { deps } = makeDeps();
    listPendingGuildsToExpire.mockRejectedValue(new Error('banco fora'));

    await expect(new PendingExpiryJob(deps).tick()).resolves.toBeUndefined();
  });

  it('não roda duas passadas ao mesmo tempo', async () => {
    const { deps } = makeDeps();
    let concorrentes = 0;
    let pico = 0;
    listPendingGuildsToExpire.mockImplementation(async () => {
      concorrentes += 1;
      pico = Math.max(pico, concorrentes);
      await Promise.resolve();
      concorrentes -= 1;
      return [];
    });

    const job = new PendingExpiryJob(deps);
    await Promise.all([job.tick(), job.tick()]);

    expect(pico).toBe(1);
  });
});
