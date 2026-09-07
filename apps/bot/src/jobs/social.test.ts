import { DEFAULT_SOCIAL_CONFIG, SOCIAL_DEFAULT_TEMPLATES } from '@cobot/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SocialAccount } from '@cobot/db';

const {
  listDueSocialAccounts,
  claimSocialPost,
  markSocialPostAnnounced,
  releaseSocialPost,
  recordSocialFailure,
  resetSocialFailures,
  touchSocialAccount,
} = vi.hoisted(() => ({
  listDueSocialAccounts: vi.fn(),
  claimSocialPost: vi.fn(),
  markSocialPostAnnounced: vi.fn(),
  releaseSocialPost: vi.fn(),
  recordSocialFailure: vi.fn(),
  resetSocialFailures: vi.fn(),
  touchSocialAccount: vi.fn(),
}));

vi.mock('@cobot/db', () => ({
  listDueSocialAccounts,
  claimSocialPost,
  markSocialPostAnnounced,
  releaseSocialPost,
  recordSocialFailure,
  resetSocialFailures,
  touchSocialAccount,
}));

const { SocialJob, socialBackoffMs } = await import('./social');

const GUILD_ID = '900000000000000000';
const CHANNEL_ID = '800000000000000000';

function fakeAccount(overrides: Partial<SocialAccount> = {}): SocialAccount {
  return {
    id: 'conta-1',
    guildId: GUILD_ID,
    platform: 'youtube',
    externalId: 'UCabcdefghijklmnopqrstuv',
    handle: 'canal',
    displayName: null,
    discordChannelId: CHANNEL_ID,
    kinds: ['video'],
    template: SOCIAL_DEFAULT_TEMPLATES.youtube,
    mentionRoleId: null,
    enabled: true,
    pollIntervalSeconds: 300,
    // `lastCheckedAt` preenchido = a conta já rodou, então nada é backlog.
    lastCheckedAt: new Date('2026-09-01T00:00:00Z'),
    lastExternalId: 'antigo',
    failureCount: 0,
    disabledReason: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

function fakeItem(externalId: string) {
  return {
    externalId,
    kind: 'video' as const,
    title: 'Vídeo novo',
    url: `https://www.youtube.com/watch?v=${externalId}`,
    author: 'Canal',
    thumbnail: null,
    publishedAt: new Date('2026-09-07T00:00:00Z'),
  };
}

function makeDeps(items: ReturnType<typeof fakeItem>[], overrides: Record<string, unknown> = {}) {
  const send = vi.fn(() => Promise.resolve({ id: 'msg-1' }));
  const channel = { isTextBased: () => true, isDMBased: () => false, send };
  const guild = { channels: { fetch: vi.fn(() => Promise.resolve(channel)) } };
  const fetchLatest = vi.fn(() => Promise.resolve(items));

  return {
    send,
    fetchLatest,
    deps: {
      db: {} as never,
      client: { guilds: { cache: { get: () => guild } } } as never,
      config: {
        get: () => Promise.resolve({ ...DEFAULT_SOCIAL_CONFIG, enabled: true }),
        getSettings: () => Promise.resolve({ embedColor: 0xdc143c }),
      } as never,
      providers: { get: () => ({ platform: 'youtube', unavailableReason: () => null, fetchLatest }) } as never,
      jitterMs: 0,
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  claimSocialPost.mockImplementation((_db: unknown, input: { externalId: string }) =>
    Promise.resolve({ id: 1, externalId: input.externalId }),
  );
  recordSocialFailure.mockResolvedValue(null);
});

describe('socialBackoffMs', () => {
  // Os números vêm escritos à mão: mudar o backoff no job tem que quebrar o
  // teste, não ser acompanhado por ele em silêncio.
  it('cresce em dobro a cada falha e para no teto de duas horas', () => {
    expect(socialBackoffMs(0)).toBe(0);
    expect(socialBackoffMs(1)).toBe(2 * 60_000);
    expect(socialBackoffMs(2)).toBe(4 * 60_000);
    expect(socialBackoffMs(3)).toBe(8 * 60_000);
    expect(socialBackoffMs(30)).toBe(120 * 60_000);
  });
});

describe('SocialJob', () => {
  it('anuncia uma publicação nova e grava a mensagem', async () => {
    const { deps, send } = makeDeps([fakeItem('novo')]);
    listDueSocialAccounts.mockResolvedValue([fakeAccount()]);

    await new SocialJob(deps).tick();

    expect(send).toHaveBeenCalledOnce();
    expect(markSocialPostAnnounced).toHaveBeenCalledWith({}, 1, 'msg-1');
    // A linha nasce antes do envio: é ela que impede o anúncio repetido.
    expect(claimSocialPost.mock.invocationCallOrder[0]).toBeLessThan(
      send.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('não anuncia duas vezes a mesma publicação', async () => {
    const { deps, send } = makeDeps([fakeItem('repetido')]);
    listDueSocialAccounts.mockResolvedValue([fakeAccount()]);
    // A unique (account_id, external_id) recusou: o job já viu esta publicação.
    claimSocialPost.mockResolvedValue(null);

    await new SocialJob(deps).tick();

    expect(send).not.toHaveBeenCalled();
  });

  it('anuncia do mais antigo para o mais novo', async () => {
    const { deps, send } = makeDeps([fakeItem('novo'), fakeItem('velho')]);
    listDueSocialAccounts.mockResolvedValue([fakeAccount()]);

    await new SocialJob(deps).tick();

    const enviados = claimSocialPost.mock.calls.map(
      ([, input]) => (input as { externalId: string }).externalId,
    );
    expect(enviados).toEqual(['velho', 'novo']);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('na primeira passada só marca o que já existia como visto', async () => {
    const { deps, send } = makeDeps([fakeItem('antigo-1'), fakeItem('antigo-2')]);
    listDueSocialAccounts.mockResolvedValue([fakeAccount({ lastCheckedAt: null })]);

    await new SocialJob(deps).tick();

    expect(claimSocialPost).toHaveBeenCalledTimes(2);
    expect(send).not.toHaveBeenCalled();
  });

  it('devolve a reserva quando o envio falha, para tentar de novo depois', async () => {
    const { deps, send } = makeDeps([fakeItem('novo')]);
    listDueSocialAccounts.mockResolvedValue([fakeAccount()]);
    send.mockRejectedValueOnce(new Error('canal sumiu'));

    await new SocialJob(deps).tick();

    expect(releaseSocialPost).toHaveBeenCalledWith({}, 1);
    expect(markSocialPostAnnounced).not.toHaveBeenCalled();
  });

  it('uma conta que falha não impede as outras e entra em backoff', async () => {
    const quebrada = fakeAccount({ id: 'quebrada' });
    const boa = fakeAccount({ id: 'boa' });
    const { deps, send } = makeDeps([fakeItem('novo')]);
    listDueSocialAccounts.mockResolvedValue([quebrada, boa]);

    const fetchLatest = vi
      .fn()
      .mockRejectedValueOnce(new Error('API fora'))
      .mockResolvedValue([fakeItem('novo')]);
    const deps2 = {
      ...deps,
      providers: { get: () => ({ unavailableReason: () => null, fetchLatest }) } as never,
      now: () => 0,
    };
    recordSocialFailure.mockResolvedValue({ ...quebrada, failureCount: 1, enabled: true });

    const job = new SocialJob(deps2);
    await job.tick();

    expect(send).toHaveBeenCalledOnce();
    expect(recordSocialFailure).toHaveBeenCalledOnce();

    // Na passada seguinte a conta em backoff é pulada; a boa continua.
    fetchLatest.mockClear();
    await job.tick();
    expect(fetchLatest).toHaveBeenCalledOnce();
  });

  it('alerta quando o banco desativa a conta no décimo erro', async () => {
    const conta = fakeAccount();
    const emit = vi.fn();
    const fetchLatest = vi.fn(() => Promise.reject(new Error('token inválido')));
    const { deps } = makeDeps([]);
    listDueSocialAccounts.mockResolvedValue([conta]);
    recordSocialFailure.mockResolvedValue({
      ...conta,
      failureCount: 10,
      enabled: false,
      disabledReason: 'token inválido',
    });

    await new SocialJob({
      ...deps,
      alerts: { emit },
      providers: { get: () => ({ unavailableReason: () => null, fetchLatest }) } as never,
    }).tick();

    expect(emit).toHaveBeenCalledOnce();
    expect(emit.mock.calls[0]?.[0]).toMatchObject({ level: 'danger' });
  });

  it('módulo desligado na guild não gasta chamada de API', async () => {
    const { deps, fetchLatest } = makeDeps([fakeItem('novo')], {
      config: {
        get: () => Promise.resolve(DEFAULT_SOCIAL_CONFIG),
        getSettings: () => Promise.resolve({ embedColor: 0 }),
      },
    });
    listDueSocialAccounts.mockResolvedValue([fakeAccount()]);

    await new SocialJob(deps).tick();

    expect(fetchLatest).not.toHaveBeenCalled();
    expect(touchSocialAccount).toHaveBeenCalledOnce();
  });
});
