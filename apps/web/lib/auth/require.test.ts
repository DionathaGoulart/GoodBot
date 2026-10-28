import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectErrorMessage } from '../test-error';

const GUILD = '111111111111111111';
const USER = '222222222222222222';
const ttl = 15 * 60 * 1000;
const currentSession = vi.fn();
const resolveGuildLevel = vi.fn();
const hit = vi.fn((_key: string) => ({ allowed: true }));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(path);
  },
}));
vi.mock('./session', () => ({ currentSession: () => currentSession() }));
vi.mock('./resolve', () => ({
  isStale: (checkedAt: number | undefined) => !checkedAt || Date.now() - checkedAt > ttl,
  resolveGuildLevel: (...args: unknown[]) => resolveGuildLevel(...args),
}));
vi.mock('@/lib/rate-limit', () => ({
  actionLimiter: { hit: (key: string) => hit(key) },
  clientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/registry', () => ({ servedGuildIds: () => Promise.resolve([GUILD]) }));

const { resolveGuildSession, requireGuildWriteAccess } = await import('./require');

function session(checkedAt: number, retryAfter?: number) {
  return {
    user: { id: USER, name: 'teste', image: null },
    guilds: { [GUILD]: { level: 'admin', checkedAt, retryAfter } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveGuildSession após revogação ou falha de revalidação', () => {
  it('bloqueia escrita com grant vencido quando o bot falha', async () => {
    currentSession.mockResolvedValue(session(Date.now() - ttl - 1));
    resolveGuildLevel.mockRejectedValue(new Error('503'));

    expect(await resolveGuildSession(GUILD, 'admin', 'write')).toEqual({ verdict: 'denied' });
  });

  it('bloqueia escrita durante espera de nova tentativa sem consultar o bot', async () => {
    currentSession.mockResolvedValue(session(Date.now() - ttl - 1, Date.now() + 60_000));

    expect(await resolveGuildSession(GUILD, 'admin', 'write')).toEqual({ verdict: 'denied' });
    expect(resolveGuildLevel).not.toHaveBeenCalled();
  });

  it('mantém leitura resiliente durante falha curta sem renovar a validade', async () => {
    currentSession.mockResolvedValue(session(Date.now() - ttl - 1, Date.now() + 60_000));

    expect(await resolveGuildSession(GUILD, 'admin')).toMatchObject({
      session: { level: 'admin' },
    });
    expect(resolveGuildLevel).not.toHaveBeenCalled();
  });

  it('nega escrita após revogação confirmada', async () => {
    currentSession.mockResolvedValue(session(Date.now() - ttl - 1));
    resolveGuildLevel.mockResolvedValue('none');

    expect(await resolveGuildSession(GUILD, 'admin', 'write')).toEqual({ verdict: 'denied' });
    expect(resolveGuildLevel).toHaveBeenCalledWith(USER, GUILD);
  });

  it('aceita escrita quando uma revalidação confirma nível suficiente', async () => {
    currentSession.mockResolvedValue(session(Date.now() - ttl - 1));
    resolveGuildLevel.mockResolvedValue('admin');

    expect(await resolveGuildSession(GUILD, 'admin', 'write')).toMatchObject({
      session: { level: 'admin', guildId: GUILD },
    });
  });

  it('guarda explícita bloqueia ação sem next-action e consome limite de escrita', async () => {
    currentSession.mockResolvedValue(session(Date.now() - ttl - 1));
    resolveGuildLevel.mockRejectedValue(new Error('503'));

    await expectErrorMessage(requireGuildWriteAccess(GUILD, 'admin'), '/denied');
    expect(hit).toHaveBeenCalledWith(`127.0.0.1:${USER}`);
  });
});
