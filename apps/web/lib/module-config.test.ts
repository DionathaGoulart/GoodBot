import { DEFAULT_LOGS_CONFIG, DEFAULT_MODERATION_CONFIG } from '@goodbot/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const GUILD_ID = '100000000000000000';

const setModuleConfig = vi.fn();
const setLogConfig = vi.fn();
const setGuildSettings = vi.fn();
const getModuleConfig = vi.fn();
const getLogConfigs = vi.fn();
const getGuildSettings = vi.fn();
const withAudit = vi.fn();
const invalidateConfig = vi.fn();
const revalidatePath = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('@goodbot/db', () => ({
  getModuleConfig: (...args: unknown[]) => getModuleConfig(...args),
  getLogConfigs: (...args: unknown[]) => getLogConfigs(...args),
  getGuildSettings: (...args: unknown[]) => getGuildSettings(...args),
  setModuleConfig: (...args: unknown[]) => setModuleConfig(...args),
  setLogConfig: (...args: unknown[]) => setLogConfig(...args),
  setGuildSettings: (...args: unknown[]) => setGuildSettings(...args),
}));
vi.mock('./db', () => ({ db: () => ({}) }));
vi.mock('./audit', () => ({ withAudit: (...args: unknown[]) => withAudit(...args) }));
vi.mock('./internal-api', () => ({ internalApi: () => ({ invalidateConfig }) }));
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock('./auth/require', () => ({
  defaultGuildId: () => GUILD_ID,
  requireGuildAccess: () =>
    Promise.resolve({
      user: { id: '200000000000000000', name: 'mod#1', image: null },
      level: 'admin',
      guildId: GUILD_ID,
    }),
}));

const { saveModuleConfig } = await import('./module-config');

function body(config: unknown): FormData {
  const formData = new FormData();
  formData.set('config', JSON.stringify(config));
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  getModuleConfig.mockResolvedValue({
    module: 'moderation',
    enabled: true,
    config: DEFAULT_MODERATION_CONFIG,
    stored: true,
    updatedAt: null,
    updatedBy: null,
  });
  invalidateConfig.mockResolvedValue({ ok: true });
});

describe('saveModuleConfig', () => {
  it('recusa payload inválido e não grava nada', async () => {
    const result = await saveModuleConfig(
      'moderation',
      body({ ...DEFAULT_MODERATION_CONFIG, banDeleteMessageDaysDefault: 99 }),
    );

    expect(result.ok).toBe(false);
    expect(result.fieldErrors).toHaveProperty('banDeleteMessageDaysDefault');
    expect(setModuleConfig).not.toHaveBeenCalled();
    expect(withAudit).not.toHaveBeenCalled();
  });

  it('recusa corpo que nem é JSON', async () => {
    const formData = new FormData();
    formData.set('config', '{isso não é json');

    expect((await saveModuleConfig('moderation', formData)).ok).toBe(false);
    expect(setModuleConfig).not.toHaveBeenCalled();
  });

  it('grava, audita com before/after e invalida o cache do bot', async () => {
    const after = { ...DEFAULT_MODERATION_CONFIG, defaultReason: 'porque sim' };
    const result = await saveModuleConfig('moderation', body(after));

    expect(result.ok).toBe(true);
    expect(setModuleConfig).toHaveBeenCalledWith(
      {},
      GUILD_ID,
      'moderation',
      expect.objectContaining({ defaultReason: 'porque sim' }),
      '200000000000000000',
    );
    expect(withAudit).toHaveBeenCalledWith(
      { id: '200000000000000000', tag: 'mod#1', guildId: GUILD_ID },
      'config.moderation.update',
      { type: 'module', id: 'moderation' },
      DEFAULT_MODERATION_CONFIG,
      expect.objectContaining({ defaultReason: 'porque sim' }),
    );
    expect(invalidateConfig).toHaveBeenCalledWith(GUILD_ID, { module: 'moderation' });
    expect(revalidatePath).toHaveBeenCalledWith(`/g/${GUILD_ID}/config/moderation`);
  });

  it('bot fora do ar não desfaz o salvamento, só avisa', async () => {
    invalidateConfig.mockRejectedValue(new Error('offline'));

    const result = await saveModuleConfig('moderation', body(DEFAULT_MODERATION_CONFIG));

    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/bot não respondeu/i);
    expect(setModuleConfig).toHaveBeenCalled();
  });

  it('a página de logs grava o módulo e uma linha por tipo de log', async () => {
    getModuleConfig.mockResolvedValue({
      module: 'logs',
      enabled: true,
      config: DEFAULT_LOGS_CONFIG,
      stored: true,
      updatedAt: null,
      updatedBy: null,
    });
    getLogConfigs.mockResolvedValue({
      modlog: {
        kind: 'modlog',
        enabled: false,
        channelId: null,
        ignoredChannelIds: [],
        ignoredRoleIds: [],
        stored: false,
      },
      messages: {
        kind: 'messages',
        enabled: false,
        channelId: null,
        ignoredChannelIds: [],
        ignoredRoleIds: [],
        stored: false,
      },
      members: {
        kind: 'members',
        enabled: false,
        channelId: null,
        ignoredChannelIds: [],
        ignoredRoleIds: [],
        stored: false,
      },
      server: {
        kind: 'server',
        enabled: false,
        channelId: null,
        ignoredChannelIds: [],
        ignoredRoleIds: [],
        stored: false,
      },
      voice: {
        kind: 'voice',
        enabled: false,
        channelId: null,
        ignoredChannelIds: [],
        ignoredRoleIds: [],
        stored: false,
      },
    });

    const kind = { enabled: false, channelId: null, ignoredChannelIds: [], ignoredRoleIds: [] };
    const result = await saveModuleConfig(
      'logs',
      body({
        module: DEFAULT_LOGS_CONFIG,
        kinds: {
          modlog: { ...kind, enabled: true, channelId: '300000000000000000' },
          messages: kind,
          members: kind,
          server: kind,
          voice: kind,
        },
      }),
    );

    expect(result.ok).toBe(true);
    expect(setLogConfig).toHaveBeenCalledTimes(5);
    expect(setLogConfig).toHaveBeenCalledWith(
      {},
      GUILD_ID,
      'modlog',
      expect.objectContaining({ enabled: true, channelId: '300000000000000000' }),
    );
  });

  it('canal inválido na grade de logs derruba o salvamento inteiro', async () => {
    const kind = { enabled: false, channelId: null, ignoredChannelIds: [], ignoredRoleIds: [] };
    const result = await saveModuleConfig(
      'logs',
      body({
        module: DEFAULT_LOGS_CONFIG,
        kinds: {
          modlog: { ...kind, channelId: 'não é um snowflake' },
          messages: kind,
          members: kind,
          server: kind,
          voice: kind,
        },
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.fieldErrors).toHaveProperty('kinds.modlog.channelId');
    expect(setLogConfig).not.toHaveBeenCalled();
    expect(setModuleConfig).not.toHaveBeenCalled();
  });
});
