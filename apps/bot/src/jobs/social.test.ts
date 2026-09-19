import { DEFAULT_SOCIAL_CONFIG, MINUTE_MS, SOCIAL_DEFAULT_TEMPLATE } from '@goodbot/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SocialAccountRef } from '../services/social/types';
import type { SocialAccount } from '@goodbot/db';
import type { SocialKind } from '@goodbot/shared';

const {
  listEnabledSocialAccounts,
  claimSocialPost,
  hasSocialPost,
  markSocialPostAnnounced,
  pauseSocialAccount,
  releaseSocialPost,
  recordSocialFailure,
  resetSocialFailures,
  touchSocialAccount,
} = vi.hoisted(() => ({
  listEnabledSocialAccounts: vi.fn(),
  claimSocialPost: vi.fn(),
  hasSocialPost: vi.fn(),
  markSocialPostAnnounced: vi.fn(),
  pauseSocialAccount: vi.fn(),
  releaseSocialPost: vi.fn(),
  recordSocialFailure: vi.fn(),
  resetSocialFailures: vi.fn(),
  touchSocialAccount: vi.fn(),
}));

vi.mock('@goodbot/db', () => ({
  listEnabledSocialAccounts,
  claimSocialPost,
  hasSocialPost,
  markSocialPostAnnounced,
  pauseSocialAccount,
  releaseSocialPost,
  recordSocialFailure,
  resetSocialFailures,
  touchSocialAccount,
}));

const { SocialJob } = await import('./social');

const GUILD_ID = '900000000000000000';
const OTHER_GUILD_ID = '900000000000000001';
const CHANNEL_ID = '800000000000000000';
const VIDEO_ROLE_ID = '700000000000000000';
const LIVE_ROLE_ID = '700000000000000001';
const YOUTUBE_ROLE_ID = '700000000000000002';
const NOW = Date.parse('2026-09-14T12:00:00Z');

function fakeAccount(overrides: Partial<SocialAccount> = {}): SocialAccount {
  return {
    id: 'conta-1',
    guildId: GUILD_ID,
    platform: 'youtube',
    externalId: 'UCabcdefghijklmnopqrstuv',
    handle: '@canal',
    displayName: 'Canal',
    avatarUrl: null,
    discordChannelId: CHANNEL_ID,
    kinds: ['video'],
    template: SOCIAL_DEFAULT_TEMPLATE,
    mentionRoleIds: [],
    liveMentionRoleIds: [],
    enabled: true,
    // `lastCheckedAt` preenchido = a conta já rodou, então nada é backlog.
    lastCheckedAt: new Date('2026-09-01T00:00:00Z'),
    pausedUntil: null,
    failureCount: 0,
    disabledReason: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

function fakeItem(externalId: string, kind: SocialKind = 'video') {
  return {
    externalId,
    kind,
    headline: 'publicou um vídeo novo',
    title: 'Vídeo novo',
    url: `https://www.youtube.com/watch?v=${externalId}`,
    author: 'Canal',
    thumbnail: null,
    publishedAt: new Date('2026-09-07T00:00:00Z'),
  };
}

function makeDeps(items: ReturnType<typeof fakeItem>[], overrides: Record<string, unknown> = {}) {
  const send = vi.fn((_message: { allowedMentions?: { roles?: string[] } }) =>
    Promise.resolve({ id: 'msg-1' }),
  );
  const channel = { isTextBased: () => true, isDMBased: () => false, send };
  const guild = { channels: { fetch: vi.fn(() => Promise.resolve(channel)) } };
  const fetchLatest = vi.fn((_account: SocialAccountRef) => Promise.resolve(items));

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
      provider: { platform: 'youtube' as const, fetchLatest } as never,
      accountDelayMs: 0,
      now: () => NOW,
      ...overrides,
    },
  };
}

/** Um provider que sempre falha, para os casos de pausa. */
function failingProvider(message = 'A plataforma respondeu 404.') {
  return {
    platform: 'youtube',
    fetchLatest: vi.fn(() => Promise.reject(new Error(message))),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  claimSocialPost.mockImplementation((_db: unknown, input: { externalId: string }) =>
    Promise.resolve({ id: 1, externalId: input.externalId }),
  );
  recordSocialFailure.mockResolvedValue(null);
  hasSocialPost.mockResolvedValue(false);
});

describe('SocialJob', () => {
  it('anuncia uma publicação nova e grava a mensagem', async () => {
    const { deps, send } = makeDeps([fakeItem('novo')]);
    listEnabledSocialAccounts.mockResolvedValue([fakeAccount()]);

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
    listEnabledSocialAccounts.mockResolvedValue([fakeAccount()]);
    // A unique (account_id, external_id) recusou: o job já viu esta publicação.
    claimSocialPost.mockResolvedValue(null);

    await new SocialJob(deps).tick();

    expect(send).not.toHaveBeenCalled();
  });

  it('anuncia do mais antigo para o mais novo', async () => {
    const { deps, send } = makeDeps([fakeItem('novo'), fakeItem('velho')]);
    listEnabledSocialAccounts.mockResolvedValue([fakeAccount()]);

    await new SocialJob(deps).tick();

    const enviados = claimSocialPost.mock.calls.map(
      ([, input]) => (input as { externalId: string }).externalId,
    );
    expect(enviados).toEqual(['velho', 'novo']);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('live pinga os cargos de lives; vídeo, os cargos de vídeos', async () => {
    const { deps, send } = makeDeps([fakeItem('ao-vivo', 'live'), fakeItem('novo')]);
    listEnabledSocialAccounts.mockResolvedValue([
      fakeAccount({
        kinds: ['video', 'live'],
        mentionRoleIds: [VIDEO_ROLE_ID, YOUTUBE_ROLE_ID],
        liveMentionRoleIds: [LIVE_ROLE_ID, YOUTUBE_ROLE_ID],
      }),
    ]);

    await new SocialJob(deps).tick();

    // Ordem cronológica: o vídeo (mais antigo) sai antes da live.
    const pingados = send.mock.calls.map(([message]) => message.allowedMentions?.roles);
    expect(pingados).toEqual([
      [VIDEO_ROLE_ID, YOUTUBE_ROLE_ID],
      [LIVE_ROLE_ID, YOUTUBE_ROLE_ID],
    ]);
  });

  it('na primeira passada só marca o que já existia como visto', async () => {
    const { deps, send } = makeDeps([fakeItem('antigo-1'), fakeItem('antigo-2')]);
    listEnabledSocialAccounts.mockResolvedValue([fakeAccount({ lastCheckedAt: null })]);

    await new SocialJob(deps).tick();

    expect(claimSocialPost).toHaveBeenCalledTimes(2);
    expect(send).not.toHaveBeenCalled();
  });

  it('devolve a reserva quando o envio falha, para tentar de novo depois', async () => {
    const { deps, send } = makeDeps([fakeItem('novo')]);
    listEnabledSocialAccounts.mockResolvedValue([fakeAccount()]);
    send.mockRejectedValueOnce(new Error('canal sumiu'));

    await new SocialJob(deps).tick();

    expect(releaseSocialPost).toHaveBeenCalledWith({}, 1);
    expect(markSocialPostAnnounced).not.toHaveBeenCalled();
  });

  it('passa `isKnown` ao provider, ligado a `social_posts`', async () => {
    const { deps, fetchLatest } = makeDeps([]);
    listEnabledSocialAccounts.mockResolvedValue([fakeAccount()]);
    hasSocialPost.mockResolvedValue(true);

    await new SocialJob(deps).tick();

    const ref = fetchLatest.mock.calls[0]?.[0];
    await expect(ref?.isKnown('abc')).resolves.toBe(true);
    expect(hasSocialPost).toHaveBeenCalledWith({}, 'conta-1', 'abc');
  });

  it('diz ao provider quando é a primeira passada da conta', async () => {
    const { deps, fetchLatest } = makeDeps([]);
    listEnabledSocialAccounts.mockResolvedValue([
      fakeAccount({ id: 'nova', lastCheckedAt: null }),
      fakeAccount({ id: 'velha' }),
    ]);

    await new SocialJob(deps).tick();

    expect(fetchLatest.mock.calls.map(([ref]) => [ref.id, ref.firstPass])).toEqual([
      ['nova', true],
      ['velha', false],
    ]);
  });

  it('uma conta que falha não impede as outras', async () => {
    const quebrada = fakeAccount({ id: 'quebrada' });
    const boa = fakeAccount({ id: 'boa' });
    const { deps, send } = makeDeps([fakeItem('novo')]);
    listEnabledSocialAccounts.mockResolvedValue([quebrada, boa]);

    const fetchLatest = vi
      .fn()
      .mockRejectedValueOnce(new Error('YouTube fora'))
      .mockResolvedValue([fakeItem('novo')]);
    recordSocialFailure.mockResolvedValue({ ...quebrada, failureCount: 1 });

    const checked = await new SocialJob({
      ...deps,
      provider: { platform: 'youtube', fetchLatest } as never,
    }).tick();

    expect(checked).toBe(2);
    expect(send).toHaveBeenCalledOnce();
    expect(recordSocialFailure).toHaveBeenCalledOnce();
  });

  it('módulo desligado na guild não gasta chamada nem toca a linha', async () => {
    const { deps, fetchLatest } = makeDeps([fakeItem('novo')], {
      config: {
        get: () => Promise.resolve(DEFAULT_SOCIAL_CONFIG),
        getSettings: () => Promise.resolve({ embedColor: 0 }),
      },
    });
    listEnabledSocialAccounts.mockResolvedValue([fakeAccount()]);

    expect(await new SocialJob(deps).tick()).toBe(0);
    expect(fetchLatest).not.toHaveBeenCalled();
    expect(touchSocialAccount).not.toHaveBeenCalled();
  });

  it('lê a config uma vez por guild, não uma por conta', async () => {
    const get = vi.fn(() => Promise.resolve({ ...DEFAULT_SOCIAL_CONFIG, enabled: true }));
    const { deps } = makeDeps([], {
      config: { get, getSettings: () => Promise.resolve({ embedColor: 0 }) },
    });
    listEnabledSocialAccounts.mockResolvedValue([
      fakeAccount({ id: 'a' }),
      fakeAccount({ id: 'b' }),
      fakeAccount({ id: 'c', guildId: OTHER_GUILD_ID }),
    ]);

    await new SocialJob(deps).tick();

    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('SocialJob · pausa automática', () => {
  it('abaixo do teto só conta a falha, sem pausa nem alerta', async () => {
    const conta = fakeAccount();
    const emit = vi.fn();
    const { deps } = makeDeps([], { alerts: { emit }, provider: failingProvider() });
    listEnabledSocialAccounts.mockResolvedValue([conta]);
    recordSocialFailure.mockResolvedValue({ ...conta, failureCount: 9 });

    await new SocialJob(deps).tick();

    expect(recordSocialFailure).toHaveBeenCalledWith({}, 'conta-1', 'A plataforma respondeu 404.');
    expect(pauseSocialAccount).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('no décimo erro seguido pausa por 15 min e alerta, sem desligar a conta', async () => {
    const conta = fakeAccount({ failureCount: 9 });
    const emit = vi.fn();
    const { deps } = makeDeps([], { alerts: { emit }, provider: failingProvider() });
    listEnabledSocialAccounts.mockResolvedValue([conta]);
    recordSocialFailure.mockResolvedValue({ ...conta, failureCount: 10 });

    await new SocialJob(deps).tick();

    expect(pauseSocialAccount).toHaveBeenCalledWith({}, 'conta-1', new Date(NOW + 15 * MINUTE_MS));
    expect(emit).toHaveBeenCalledOnce();
    expect(emit.mock.calls[0]?.[0]).toMatchObject({
      kind: 'social:conta-1',
      level: 'warning',
    });
  });

  it('as falhas seguintes dobram a pausa sem repetir o alerta', async () => {
    const conta = fakeAccount({ failureCount: 10, pausedUntil: new Date(NOW - MINUTE_MS) });
    const emit = vi.fn();
    const { deps } = makeDeps([], { alerts: { emit }, provider: failingProvider() });
    listEnabledSocialAccounts.mockResolvedValue([conta]);
    recordSocialFailure.mockResolvedValue({ ...conta, failureCount: 11 });

    await new SocialJob(deps).tick();

    expect(pauseSocialAccount).toHaveBeenCalledWith({}, 'conta-1', new Date(NOW + 30 * MINUTE_MS));
    expect(emit).not.toHaveBeenCalled();
    expect(resetSocialFailures).not.toHaveBeenCalled();
  });

  it('pula a conta em pausa sem chamar a API nem tocar a linha', async () => {
    const { deps, fetchLatest } = makeDeps([fakeItem('novo')]);
    listEnabledSocialAccounts.mockResolvedValue([
      fakeAccount({ failureCount: 10, pausedUntil: new Date(NOW + MINUTE_MS) }),
    ]);

    expect(await new SocialJob(deps).tick()).toBe(0);
    expect(fetchLatest).not.toHaveBeenCalled();
    expect(touchSocialAccount).not.toHaveBeenCalled();
  });

  it('pausa vencida tenta de novo; o primeiro sucesso tira a pausa e avisa', async () => {
    const emit = vi.fn();
    const { deps, fetchLatest, send } = makeDeps([fakeItem('novo')], { alerts: { emit } });
    listEnabledSocialAccounts.mockResolvedValue([
      fakeAccount({
        failureCount: 12,
        pausedUntil: new Date(NOW),
        disabledReason: 'A plataforma respondeu 404.',
      }),
    ]);

    expect(await new SocialJob(deps).tick()).toBe(1);
    expect(fetchLatest).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    expect(resetSocialFailures).toHaveBeenCalledWith({}, 'conta-1');
    expect(pauseSocialAccount).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledOnce();
    expect(emit.mock.calls[0]?.[0]).toMatchObject({
      kind: 'social:conta-1:retomada',
      level: 'success',
    });
  });

  it('sucesso sem pausa anterior não manda aviso de volta', async () => {
    const emit = vi.fn();
    const { deps } = makeDeps([], { alerts: { emit } });
    listEnabledSocialAccounts.mockResolvedValue([fakeAccount({ failureCount: 3 })]);

    await new SocialJob(deps).tick();

    expect(resetSocialFailures).toHaveBeenCalledWith({}, 'conta-1');
    expect(emit).not.toHaveBeenCalled();
  });

  it('conta removida no meio da passada não é pausada', async () => {
    const { deps } = makeDeps([], { provider: failingProvider() });
    listEnabledSocialAccounts.mockResolvedValue([fakeAccount({ failureCount: 9 })]);
    recordSocialFailure.mockResolvedValue(null);

    await new SocialJob(deps).tick();

    expect(pauseSocialAccount).not.toHaveBeenCalled();
  });
});
