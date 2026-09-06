import { describe, expect, it } from 'vitest';

import { MAX_TIMEOUT_MS, MODULES } from '../constants';
import { AutomodRuleSchema } from './automod-rule';
import { GuildSettingsSchema, isValidTimezone } from './guild-settings';
import {
  DEFAULT_MODULE_CONFIGS,
  MODULE_SCHEMAS,
  parseModuleConfig,
  parseModuleConfigOrDefault,
} from './index';
import { LogsPageSchema } from './logs';
import { ModerationConfigSchema } from './moderation';
import { TagInputSchema } from './tags';

describe('MODULE_SCHEMAS', () => {
  it('cobre exatamente os módulos de MODULES', () => {
    expect(Object.keys(MODULE_SCHEMAS).sort()).toEqual([...MODULES].sort());
    expect(Object.keys(DEFAULT_MODULE_CONFIGS).sort()).toEqual([...MODULES].sort());
  });

  it.each(MODULES)('%s: aceita {} e produz o default com version 1', (module) => {
    const parsed = parseModuleConfig(module, {});
    expect(parsed).toEqual(DEFAULT_MODULE_CONFIGS[module]);
    expect(parsed.version).toBe(1);
    expect(typeof parsed.enabled).toBe('boolean');
  });

  it.each(MODULES)('%s: o default é idempotente (parse(default) === default)', (module) => {
    const def = DEFAULT_MODULE_CONFIGS[module];
    expect(parseModuleConfig(module, def)).toEqual(def);
  });

  it.each(MODULES)('%s: rejeita version diferente de 1', (module) => {
    expect(MODULE_SCHEMAS[module].safeParse({ version: 2 }).success).toBe(false);
  });

  it('parseModuleConfigOrDefault volta ao default em jsonb inválido', () => {
    expect(parseModuleConfigOrDefault('tags', { maxTags: 'muitas' })).toEqual({
      config: DEFAULT_MODULE_CONFIGS.tags,
      valid: false,
    });
    expect(parseModuleConfigOrDefault('tags', null)).toEqual({
      config: DEFAULT_MODULE_CONFIGS.tags,
      valid: true,
    });
    expect(parseModuleConfigOrDefault('tags', { maxTags: 10 })).toMatchObject({
      config: { maxTags: 10 },
      valid: true,
    });
  });

  it('valida snowflakes e remove duplicatas em listas de IDs', () => {
    const parsed = parseModuleConfig('autorole', {
      humanRoleIds: ['123456789012345678', '123456789012345678', '223456789012345678'],
    });
    expect(parsed.humanRoleIds).toEqual(['123456789012345678', '223456789012345678']);
    expect(MODULE_SCHEMAS.autorole.safeParse({ humanRoleIds: ['abc'] }).success).toBe(false);
    expect(MODULE_SCHEMAS.autorole.safeParse({ humanRoleIds: [123] }).success).toBe(false);
  });
});

describe('ModerationConfigSchema.escalation', () => {
  it('exige duração para escalada em timeout', () => {
    const bad = ModerationConfigSchema.safeParse({
      escalation: { enabled: true, steps: [{ warns: 3, action: 'timeout' }] },
    });
    expect(bad.success).toBe(false);
    const ok = ModerationConfigSchema.safeParse({
      escalation: {
        enabled: true,
        steps: [
          { warns: 3, action: 'timeout', durationMs: 3_600_000 },
          { warns: 5, action: 'kick' },
        ],
      },
    });
    expect(ok.success).toBe(true);
  });

  it('rejeita quantidade de warns repetida e timeout acima de 28d', () => {
    expect(
      ModerationConfigSchema.safeParse({
        escalation: {
          steps: [
            { warns: 3, action: 'kick' },
            { warns: 3, action: 'ban' },
          ],
        },
      }).success,
    ).toBe(false);
    expect(ModerationConfigSchema.safeParse({ defaultTimeoutMs: MAX_TIMEOUT_MS + 1 }).success).toBe(
      false,
    );
  });
});

describe('AutomodRuleSchema', () => {
  const base = { name: 'regra', actions: [{ type: 'delete' }] };

  it('aplica defaults do config específico de cada tipo', () => {
    const spam = AutomodRuleSchema.parse({ ...base, type: 'spam' });
    expect(spam.type).toBe('spam');
    expect(spam.config).toEqual({
      maxMessages: 5,
      intervalSeconds: 5,
      maxDuplicates: 3,
      perChannel: false,
    });
    expect(spam.priority).toBe(100);
    expect(spam.enabled).toBe(true);
    expect(spam.exemptRoleIds).toEqual([]);
  });

  it('rejeita tipo desconhecido e config de outro tipo', () => {
    expect(AutomodRuleSchema.safeParse({ ...base, type: 'emoji' }).success).toBe(false);
    expect(
      AutomodRuleSchema.safeParse({ ...base, type: 'caps', config: { minPercent: 150 } }).success,
    ).toBe(false);
    expect(
      AutomodRuleSchema.safeParse({ ...base, type: 'links', config: { allowedDomains: 'x.com' } })
        .success,
    ).toBe(false);
  });

  it('exige pelo menos uma ação e no máximo uma punição', () => {
    expect(AutomodRuleSchema.safeParse({ name: 'r', type: 'spam', actions: [] }).success).toBe(
      false,
    );
    expect(
      AutomodRuleSchema.safeParse({
        name: 'r',
        type: 'spam',
        actions: [{ type: 'kick' }, { type: 'ban' }],
      }).success,
    ).toBe(false);
    expect(
      AutomodRuleSchema.safeParse({
        name: 'r',
        type: 'spam',
        actions: [{ type: 'delete' }, { type: 'delete' }],
      }).success,
    ).toBe(false);
  });

  it('valida parâmetros das ações', () => {
    expect(
      AutomodRuleSchema.safeParse({ name: 'r', type: 'spam', actions: [{ type: 'timeout' }] })
        .success,
    ).toBe(false);
    expect(
      AutomodRuleSchema.safeParse({
        name: 'r',
        type: 'spam',
        actions: [{ type: 'timeout', durationMs: MAX_TIMEOUT_MS + 1 }],
      }).success,
    ).toBe(false);
    const ok = AutomodRuleSchema.parse({
      name: 'r',
      type: 'spam',
      actions: [{ type: 'delete' }, { type: 'timeout', durationMs: 60_000 }, { type: 'dm_user' }],
    });
    expect(ok.actions).toHaveLength(3);
  });

  it('regex inválido no filtro de palavras é rejeitado', () => {
    expect(
      AutomodRuleSchema.safeParse({
        ...base,
        type: 'words',
        config: { mode: 'regex', words: ['(abc'] },
      }).success,
    ).toBe(false);
    expect(
      AutomodRuleSchema.safeParse({
        ...base,
        type: 'words',
        config: { mode: 'regex', words: ['a+b'] },
      }).success,
    ).toBe(true);
    expect(
      AutomodRuleSchema.safeParse({ ...base, type: 'words', config: { words: [] } }).success,
    ).toBe(false);
  });

  it('regra anti-raid não pode ter ação delete', () => {
    expect(AutomodRuleSchema.safeParse({ ...base, type: 'raid' }).success).toBe(false);
    const ok = AutomodRuleSchema.parse({
      name: 'raid',
      type: 'raid',
      actions: [{ type: 'notify_modlog' }],
      config: { action: 'require_account_age', minAccountAgeDays: 3 },
    });
    expect(ok.config).toMatchObject({ action: 'require_account_age', minAccountAgeDays: 3 });
  });

  it('normaliza domínios para minúsculas', () => {
    const rule = AutomodRuleSchema.parse({
      ...base,
      type: 'links',
      config: { allowedDomains: ['GitHub.com'] },
    });
    expect(rule.type === 'links' && rule.config.allowedDomains).toEqual(['github.com']);
  });
});

describe('GuildSettingsSchema', () => {
  it('aplica os defaults do PRD §8 quando a guild ainda não tem linha', () => {
    expect(GuildSettingsSchema.parse({})).toEqual({
      timezone: 'America/Sao_Paulo',
      embedColor: 0xdc143c,
      modRoleIds: [],
      adminRoleIds: [],
      dashboardAccessRoleIds: [],
      logChannelId: null,
      dmOnPunish: null,
    });
  });

  it('recusa fuso que o Intl não conhece', () => {
    expect(isValidTimezone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimezone('Marte/Olympus')).toBe(false);
    expect(GuildSettingsSchema.safeParse({ timezone: 'Marte/Olympus' }).success).toBe(false);
  });

  it('recusa cor fora de 24 bits e ID que não é snowflake', () => {
    expect(GuildSettingsSchema.safeParse({ embedColor: 0x1000000 }).success).toBe(false);
    expect(GuildSettingsSchema.safeParse({ logChannelId: '12' }).success).toBe(false);
  });

  it('`dmOnPunish` só existe como override completo', () => {
    const parsed = GuildSettingsSchema.parse({ dmOnPunish: {} });
    expect(parsed.dmOnPunish).toEqual({
      ban: true,
      softban: true,
      kick: true,
      timeout: true,
      warn: true,
    });
  });
});

describe('LogsPageSchema', () => {
  const kind = { enabled: false, channelId: null, ignoredChannelIds: [], ignoredRoleIds: [] };
  const kinds = { modlog: kind, messages: kind, members: kind, server: kind, voice: kind };

  it('exige um item para cada tipo de log', () => {
    expect(LogsPageSchema.safeParse({ module: {}, kinds: { modlog: kind } }).success).toBe(false);
    expect(LogsPageSchema.parse({ module: {}, kinds }).kinds.voice).toEqual(kind);
  });

  it('canal inválido em um tipo derruba a página inteira', () => {
    const result = LogsPageSchema.safeParse({
      module: {},
      kinds: { ...kinds, modlog: { ...kind, channelId: 'nope' } },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path.join('.')).toBe('kinds.modlog.channelId');
  });
});

describe('TagInputSchema', () => {
  it('aceita letras com acento, número, `_` e `-`', () => {
    expect(TagInputSchema.parse({ name: 'regras-2', content: { content: 'oi' } }).name).toBe(
      'regras-2',
    );
    expect(TagInputSchema.safeParse({ name: 'reg ras', content: { content: 'oi' } }).success).toBe(
      false,
    );
  });

  it('exige conteúdo: nem texto nem embed não é tag', () => {
    expect(TagInputSchema.safeParse({ name: 'vazia', content: {} }).success).toBe(false);
    expect(TagInputSchema.safeParse({ name: 'vazia', content: { content: '  ' } }).success).toBe(
      false,
    );
  });
});
