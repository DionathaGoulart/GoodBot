import { AUTOMOD_RULE_TYPES, AutomodRuleSchema } from '@cobot/shared';
import { describe, expect, it } from 'vitest';

import { emptyRule, resetForType } from './rule-defaults';

/**
 * O formulário de regra troca de campos conforme o `type`. Se o default de um
 * tipo não passar no schema, o usuário abre o `sheet` e não consegue salvar
 * sem entender por quê — daí o teste cobrir os seis tipos.
 */
describe('formulário dinâmico do automod', () => {
  it.each(AUTOMOD_RULE_TYPES)('gera payload válido para %s', (type) => {
    const rule = { ...emptyRule(type), name: `regra ${type}` };
    if (rule.type === 'words') rule.config.words = ['palavra'];

    const parsed = AutomodRuleSchema.safeParse(rule);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('trocar o tipo zera config e ações, mas mantém nome e isenções', () => {
    const spam = {
      ...emptyRule('spam'),
      name: 'flood',
      priority: 20,
      exemptRoleIds: ['100000000000000000'],
    };

    const caps = resetForType(spam, 'caps');

    expect(caps.type).toBe('caps');
    expect(caps.name).toBe('flood');
    expect(caps.priority).toBe(20);
    expect(caps.exemptRoleIds).toEqual(['100000000000000000']);
    expect(caps.config).toEqual({ minPercent: 70, minLength: 10 });
    expect(AutomodRuleSchema.safeParse(caps).success).toBe(true);
  });

  it('regra anti-raid não nasce apagando mensagem', () => {
    expect(emptyRule('raid').actions.some((action) => action.type === 'delete')).toBe(false);
  });
});
