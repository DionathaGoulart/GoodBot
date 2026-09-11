import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GuildRegistryEntry } from '@goodbot/db';
import type { EmbedBuilder } from 'discord.js';
import type { Mock } from 'vitest';

const { listDemoGuildsToWarn, listExpiredDemoGuilds, markDemoWarned, markDemoEnded } = vi.hoisted(
  () => ({
    listDemoGuildsToWarn: vi.fn(),
    listExpiredDemoGuilds: vi.fn(),
    markDemoWarned: vi.fn(),
    markDemoEnded: vi.fn(),
  }),
);

vi.mock('@goodbot/db', () => ({
  listDemoGuildsToWarn,
  listExpiredDemoGuilds,
  markDemoWarned,
  markDemoEnded,
}));

const { DemoExpiryJob } = await import('./demo-expiry');

const GUILD_ID = '900000000000000000';
const AGORA = new Date('2026-09-10T12:00:00Z');

function entry(overrides: Partial<GuildRegistryEntry> = {}): GuildRegistryEntry {
  return {
    guildId: GUILD_ID,
    status: 'demo',
    invitedBy: '700000000000000000',
    invitedAt: AGORA,
    approvedAt: null,
    expiresAt: new Date(AGORA.getTime() + 5 * 60_000),
    demoWarnedAt: null,
    demoEndedAt: null,
    leftAt: null,
    note: null,
    createdAt: AGORA,
    updatedAt: AGORA,
    ...overrides,
  };
}

/** A descrição do primeiro embed enviado. */
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
    fetchUser,
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
  listDemoGuildsToWarn.mockResolvedValue([]);
  listExpiredDemoGuilds.mockResolvedValue([]);
  markDemoWarned.mockResolvedValue(undefined);
  markDemoEnded.mockResolvedValue(undefined);
});

describe('DemoExpiryJob', () => {
  it('avisa no privado de quem convidou, e não no canal do servidor', async () => {
    const { deps, send, dm, fetchUser } = makeDeps();
    listDemoGuildsToWarn.mockResolvedValue([entry()]);

    await new DemoExpiryJob(deps).tick();

    expect(fetchUser).toHaveBeenCalledWith('700000000000000000');
    expect(dm).toHaveBeenCalledOnce();
    expect(descricaoDo(dm)).toContain('https://invite.goodbot.example/');
    // O servidor inteiro não precisa da contagem regressiva de um bot que
    // ainda está funcionando: quem decide pedir a aprovação é quem convidou.
    expect(send).not.toHaveBeenCalled();
  });

  it('sem quem convidar (linha semeada), o aviso simplesmente não sai', async () => {
    const { deps, dm, send } = makeDeps();
    listDemoGuildsToWarn.mockResolvedValue([entry({ invitedBy: null })]);

    await expect(new DemoExpiryJob(deps).tick()).resolves.toBeUndefined();
    expect(dm).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(markDemoWarned).toHaveBeenCalledOnce();
  });

  it('DM fechada não trava a passada', async () => {
    const { deps, fetchUser } = makeDeps();
    fetchUser.mockRejectedValue(new Error('Cannot send messages to this user'));
    listDemoGuildsToWarn.mockResolvedValue([entry()]);

    await expect(new DemoExpiryJob(deps).tick()).resolves.toBeUndefined();
    expect(markDemoWarned).toHaveBeenCalledOnce();
  });

  it('marca o aviso antes de enviar: falhar no envio custa um aviso, não um por minuto', async () => {
    const { deps, dm } = makeDeps();
    listDemoGuildsToWarn.mockResolvedValue([entry()]);

    await new DemoExpiryJob(deps).tick();

    expect(markDemoWarned.mock.invocationCallOrder[0]).toBeLessThan(
      dm.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(markDemoWarned).toHaveBeenCalledWith({}, GUILD_ID, AGORA);
  });

  it('usa o relógio injetado para consultar o registro', async () => {
    const { deps } = makeDeps();

    await new DemoExpiryJob({ ...deps, warnBeforeMs: 60_000 }).tick();

    expect(listDemoGuildsToWarn).toHaveBeenCalledWith({}, 60_000, AGORA);
    expect(listExpiredDemoGuilds).toHaveBeenCalledWith({}, AGORA);
  });

  it('se despede no servidor E no privado, sai e marca o fim — nessa ordem', async () => {
    const { deps, send, dm, leave } = makeDeps();
    listExpiredDemoGuilds.mockResolvedValue([entry({ expiresAt: AGORA })]);

    await new DemoExpiryJob(deps).tick();

    expect(send).toHaveBeenCalledOnce();
    expect(dm).toHaveBeenCalledOnce();
    expect(leave).toHaveBeenCalledOnce();
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(leave.mock.invocationCallOrder[0] ?? 0);
    expect(leave.mock.invocationCallOrder[0]).toBeLessThan(
      markDemoEnded.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('marca o fim mesmo quando não consegue sair — insistir só faria ruído', async () => {
    const { deps, cache } = makeDeps();
    listExpiredDemoGuilds.mockResolvedValue([entry({ expiresAt: AGORA })]);
    cache.get.mockReturnValue({
      id: GUILD_ID,
      name: 'Servidor de teste',
      systemChannel: null,
      channels: { cache: new Map() },
      leave: () => Promise.reject(new Error('sem permissão')),
    });

    await expect(new DemoExpiryJob(deps).tick()).resolves.toBeUndefined();
    expect(markDemoEnded).toHaveBeenCalledWith({}, GUILD_ID, AGORA);
  });

  it('guild fora do cache: encerra a linha sem tentar falar nem sair', async () => {
    const { deps, send, leave, cache } = makeDeps();
    listExpiredDemoGuilds.mockResolvedValue([entry({ expiresAt: AGORA })]);
    cache.get.mockReturnValue(undefined);

    await new DemoExpiryJob(deps).tick();

    expect(send).not.toHaveBeenCalled();
    expect(leave).not.toHaveBeenCalled();
    expect(markDemoEnded).toHaveBeenCalledOnce();
  });

  it('sem canal onde falar, a saída acontece do mesmo jeito', async () => {
    const { deps, leave, guild } = makeDeps();
    listExpiredDemoGuilds.mockResolvedValue([entry({ expiresAt: AGORA })]);
    guild.systemChannel = null as never;
    (guild as { channels?: unknown }).channels = { cache: new Map() };

    await new DemoExpiryJob(deps).tick();

    expect(leave).toHaveBeenCalledOnce();
    expect(markDemoEnded).toHaveBeenCalledOnce();
  });

  it('banco fora não derruba a passada', async () => {
    const { deps } = makeDeps();
    listDemoGuildsToWarn.mockRejectedValue(new Error('banco fora'));

    await expect(new DemoExpiryJob(deps).tick()).resolves.toBeUndefined();
  });

  it('não roda duas passadas ao mesmo tempo', async () => {
    const { deps } = makeDeps();
    let concorrentes = 0;
    let pico = 0;
    listDemoGuildsToWarn.mockImplementation(async () => {
      concorrentes += 1;
      pico = Math.max(pico, concorrentes);
      await Promise.resolve();
      concorrentes -= 1;
      return [];
    });

    const job = new DemoExpiryJob(deps);
    await Promise.all([job.tick(), job.tick()]);

    expect(pico).toBe(1);
  });

  it('sem AUTH_URL o aviso sai sem link, não sai errado', async () => {
    const { deps, dm } = makeDeps({ urls: { invite: null, panel: null } });
    listDemoGuildsToWarn.mockResolvedValue([entry()]);

    await new DemoExpiryJob(deps).tick();

    expect(descricaoDo(dm)).toContain('convite normal');
    expect(descricaoDo(dm)).not.toContain('http');
  });
});
