import type { AutomodRule, AutomodRuleConfigOf, AutomodRuleType } from '@cobot/shared';

/** Cada tipo nasce com o default do schema; `words` não tem lista padrão. */
const DEFAULT_CONFIG: { [T in AutomodRuleType]: AutomodRuleConfigOf<T> } = {
  spam: { maxMessages: 5, intervalSeconds: 5, maxDuplicates: 3, perChannel: false },
  links: { allowedDomains: [], blockInvites: true, invitesOnly: false, allowedChannelIds: [] },
  caps: { minPercent: 70, minLength: 10 },
  words: { mode: 'exact', words: [], caseSensitive: false, normalizeDiacritics: true },
  mentions: { maxMentions: 5, blockEveryone: true, countRoles: true },
  raid: {
    joins: 10,
    intervalSeconds: 30,
    raidModeMinutes: 10,
    action: 'kick',
    minAccountAgeDays: 7,
    alertModlog: true,
  },
};

/**
 * O rascunho com que o `sheet` abre. Não passa pelo schema de propósito: um
 * formulário novo começa com o nome vazio (e `words` sem lista), que o schema
 * recusaria — a validação é do submit, não da abertura da tela.
 */
export function emptyRule(type: AutomodRuleType = 'spam'): AutomodRule {
  return {
    name: '',
    type,
    enabled: true,
    priority: 100,
    actions: type === 'raid' ? [{ type: 'kick' }] : [{ type: 'delete' }],
    config: DEFAULT_CONFIG[type],
    exemptRoleIds: [],
    exemptChannelIds: [],
    // O rascunho ainda não é uma `AutomodRule` válida (nome vazio, `words`
    // sem lista); quem cobra isso é o `zodResolver` do `sheet`, no submit.
  } as unknown as AutomodRule;
}

/** Trocar o tipo tem que zerar `config`/`actions`; sem isso o Zod recusa o payload. */
export function resetForType(current: AutomodRule, type: AutomodRuleType): AutomodRule {
  return {
    ...emptyRule(type),
    name: current.name,
    enabled: current.enabled,
    priority: current.priority,
    exemptRoleIds: current.exemptRoleIds,
    exemptChannelIds: current.exemptChannelIds,
  };
}
