import { describe, expect, it } from 'vitest';

import { MAX_TIMEOUT_MS, MODULES } from '../constants';
import { AutomodRuleSchema } from './automod-rule';
import {
  DEFAULT_MODULE_CONFIGS,
  MODULE_SCHEMAS,
  parseModuleConfig,
  parseModuleConfigOrDefault,
} from './index';
import { ModerationConfigSchema } from './moderation';

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
