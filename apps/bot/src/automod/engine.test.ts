import { AutomodRuleSchema, DEFAULT_AUTOMOD_CONFIG } from '@goodbot/shared';
import { Collection, PermissionFlagsBits } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AutomodService,
  globalExemption,
  raidActions,
  ruleExemption,
  toLoadedRule,
} from './engine';

import type { LoadedRule } from './types';
import type { ConfigService } from '../services/config';
import type { ModerationService } from '../services/moderation';
import type { ModlogService } from '../services/modlog';
import type { AutomodRuleRow, Db } from '@goodbot/db';
import type { AutomodConfig } from '@goodbot/shared';
import type { Guild, GuildMember, Message } from 'discord.js';

const { getAutomodRules, recordAutomodHit, deleteAutomodHitsBefore } = vi.hoisted(() => ({
  getAutomodRules: vi.fn(),
  recordAutomodHit: vi.fn(),
  deleteAutomodHitsBefore: vi.fn(),
}));

vi.mock('@goodbot/db', () => ({ getAutomodRules, recordAutomodHit, deleteAutomodHitsBefore }));

const GUILD_ID = '900000000000000000';
const CHANNEL_ID = '800000000000000000';
const USER_ID = '700000000000000000';
const EXEMPT_ROLE_ID = '600000000000000000';

/** Linha de `automod_rules` como o Drizzle devolveria. */
function row(overrides: Partial<AutomodRuleRow> = {}): AutomodRuleRow {
  return {
    id: 'rule-1',
    guildId: GUILD_ID,
    name: 'Sem links',
    type: 'links',
    enabled: true,
    priority: 100,
    config: { allowedDomains: [], blockInvites: true },
    actions: [{ type: 'delete' }, { type: 'warn' }],
    exemptRoleIds: [],
    exemptChannelIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AutomodRuleRow;
}

interface Fakes {
  automod: AutomodService;
  moderation: { warn: ReturnType<typeof vi.fn>; kick: ReturnType<typeof vi.fn> };
  modlog: { postAction: ReturnType<typeof vi.fn> };
}

function createService(config: Partial<AutomodConfig> = {}): Fakes {
  const moderation = {
    warn: vi.fn().mockResolvedValue({ case: {}, dmSent: false }),
    kick: vi.fn().mockResolvedValue({ case: {}, dmSent: false }),
    ban: vi.fn().mockResolvedValue({ case: {}, dmSent: false }),
    timeout: vi.fn().mockResolvedValue({ case: {}, dmSent: false }),
  };
  const modlog = { postAction: vi.fn().mockResolvedValue(undefined) };
  const configService = {
    get: vi.fn().mockResolvedValue({ ...DEFAULT_AUTOMOD_CONFIG, enabled: true, ...config }),
    bus: { subscribe: vi.fn(), publish: vi.fn() },
  };

  const automod = new AutomodService({
    db: {} as Db,
    config: configService as unknown as ConfigService,
    moderation: moderation as unknown as ModerationService,
    modlog: modlog as unknown as ModlogService,
  });

  return { automod, moderation, modlog };
}

interface MessageOptions {
  content: string;
  roleIds?: string[];
  moderator?: boolean;
}

function makeMessage(options: MessageOptions): {
  message: Message;
  remove: ReturnType<typeof vi.fn>;
} {
  const remove = vi.fn().mockResolvedValue(undefined);
  const roles = new Collection<string, unknown>();
  for (const id of options.roleIds ?? []) roles.set(id, { id });

  const member = {
    roles: { cache: roles },
    permissions: {
      has: (flag: bigint) =>
        (options.moderator ?? false) && flag === PermissionFlagsBits.ManageMessages,
    },
  } as unknown as GuildMember;

  const message = {
    id: '1',
    guild: { id: GUILD_ID, members: { cache: new Collection() } } as unknown as Guild,
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
    author: { id: USER_ID, bot: false, system: false, tag: 'alvo#0001' },
    member,
    content: options.content,
    mentions: { users: new Collection(), roles: new Collection(), everyone: false },
    createdTimestamp: 1_000,
    deletable: true,
    delete: remove,
  } as unknown as Message;

  return { message, remove };
}

beforeEach(() => {
  vi.clearAllMocks();
  getAutomodRules.mockResolvedValue([row()]);
  recordAutomodHit.mockResolvedValue(undefined);
});

describe('AutomodService.handleMessage', () => {
  it('apaga a mensagem, cria o caso de warn e grava o hit', async () => {
    const { automod, moderation } = createService();
    const { message, remove } = makeMessage({ content: 'olha https://malicioso.tld' });

    const hit = await automod.handleMessage(message);

    expect(hit?.id).toBe('rule-1');
    expect(remove).toHaveBeenCalledOnce();
    expect(moderation.warn).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'automod', automodRuleId: 'rule-1' }),
    );
    expect(recordAutomodHit).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ ruleId: 'rule-1', userId: USER_ID, actionTaken: 'delete,warn' }),
    );
  });

  it('não age quando o módulo está desligado', async () => {
    const { automod, moderation } = createService({ enabled: false });
    const { message } = makeMessage({ content: 'https://malicioso.tld' });

    expect(await automod.handleMessage(message)).toBeNull();
    expect(moderation.warn).not.toHaveBeenCalled();
  });

  it('não age sobre cargo isento', async () => {
    const { automod, moderation } = createService({ exemptRoleIds: [EXEMPT_ROLE_ID] });
    const { message, remove } = makeMessage({
      content: 'https://malicioso.tld',
      roleIds: [EXEMPT_ROLE_ID],
    });

    expect(await automod.handleMessage(message)).toBeNull();
    expect(remove).not.toHaveBeenCalled();
    expect(moderation.warn).not.toHaveBeenCalled();
  });

  it('não age sobre moderador quando exemptModerators está ligado', async () => {
    const { automod } = createService({ exemptModerators: true });
    const { message, remove } = makeMessage({
      content: 'https://malicioso.tld',
      moderator: true,
    });

    expect(await automod.handleMessage(message)).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it('ignora edições quando checkEdits está desligado', async () => {
    const { automod } = createService({ checkEdits: false });
    const { message, remove } = makeMessage({ content: 'https://malicioso.tld' });

    expect(await automod.handleMessage(message, { isEdit: true })).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it('para na primeira regra que dispara', async () => {
    getAutomodRules.mockResolvedValue([
      row({ id: 'rule-1', priority: 10 }),
      row({
        id: 'rule-2',
        priority: 20,
        type: 'caps',
        name: 'Sem gritaria',
        config: { minPercent: 1, minLength: 1 },
        actions: [{ type: 'delete' }],
      }),
    ]);
    const { automod } = createService();
    const { message } = makeMessage({ content: 'OLHA https://MALICIOSO.TLD' });

    const hit = await automod.handleMessage(message);
    expect(hit?.id).toBe('rule-1');
    expect(recordAutomodHit).toHaveBeenCalledOnce();
  });

  it('ignora a linha cujo jsonb não bate com o schema', async () => {
    getAutomodRules.mockResolvedValue([row({ type: 'words', config: {} })]);
    const { automod } = createService();
    const { message, remove } = makeMessage({ content: 'qualquer coisa' });

    expect(await automod.handleMessage(message)).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  const loaded: LoadedRule = {
    id: 'r',
    rule: AutomodRuleSchema.parse({
      name: 'x',
      type: 'caps',
      actions: [{ type: 'delete' }],
      exemptRoleIds: [EXEMPT_ROLE_ID],
      exemptChannelIds: [CHANNEL_ID],
    }),
  };

  it('globalExemption cobre canal, cargo e moderador', () => {
    const config = {
      exemptChannelIds: [CHANNEL_ID],
      exemptRoleIds: [EXEMPT_ROLE_ID],
      exemptModerators: true,
    };
    expect(
      globalExemption(config, { channelId: CHANNEL_ID, roleIds: [], isModerator: false }),
    ).toBe('exempt-channel');
    expect(
      globalExemption(config, {
        channelId: 'outro',
        roleIds: [EXEMPT_ROLE_ID],
        isModerator: false,
      }),
    ).toBe('exempt-role');
    expect(globalExemption(config, { channelId: 'outro', roleIds: [], isModerator: true })).toBe(
      'exempt-moderator',
    );
    expect(
      globalExemption(config, { channelId: 'outro', roleIds: [], isModerator: false }),
    ).toBeNull();
  });

  it('ruleExemption usa as listas da própria regra', () => {
    expect(ruleExemption(loaded, { channelId: CHANNEL_ID, roleIds: [] })).toBe(true);
    expect(ruleExemption(loaded, { channelId: 'outro', roleIds: [EXEMPT_ROLE_ID] })).toBe(true);
    expect(ruleExemption(loaded, { channelId: 'outro', roleIds: [] })).toBe(false);
  });

  it('raidActions completa com a ação do config quando não há punição', () => {
    expect(raidActions([{ type: 'notify_modlog' }], 'kick')).toEqual([
      { type: 'notify_modlog' },
      { type: 'kick' },
    ]);
    expect(raidActions([{ type: 'ban', deleteMessageDays: 0 }], 'kick')).toEqual([
      { type: 'ban', deleteMessageDays: 0 },
    ]);
    expect(raidActions([{ type: 'notify_modlog' }], 'require_account_age')).toEqual([
      { type: 'notify_modlog' },
      { type: 'kick' },
    ]);
  });

  it('toLoadedRule devolve null para jsonb inválido', () => {
    expect(toLoadedRule(row({ type: 'words', config: {} }))).toBeNull();
    expect(toLoadedRule(row())?.rule.type).toBe('links');
  });
});
