import { UserFacingError } from '@cobot/shared';

import type { LoadedRule } from '../../automod/types';
import type { AutomodRuleType } from '@cobot/shared';

/** Nome de cada tipo de regra em pt-BR (embeds e escolhas dos comandos). */
export const RULE_TYPE_LABELS: Record<AutomodRuleType, string> = {
  spam: 'Anti-spam',
  links: 'Anti-links',
  caps: 'Anti-caps',
  words: 'Filtro de palavras',
  mentions: 'Menção em massa',
  raid: 'Anti-raid',
};

/**
 * Resolve o que o usuário digitou em `<regra>`: o id da linha (vem do
 * autocomplete), o nome da regra ou o tipo (`words`) — o último caso existe
 * porque `/automod test words "palavra"` é o uso natural.
 */
export function resolveRule(rules: readonly LoadedRule[], query: string): LoadedRule {
  const needle = query.trim().toLowerCase();

  const byId = rules.find((loaded) => loaded.id === query.trim());
  if (byId) return byId;

  const byName = rules.find((loaded) => loaded.rule.name.toLowerCase() === needle);
  if (byName) return byName;

  const byType = rules.find((loaded) => loaded.rule.type === needle);
  if (byType) return byType;

  const partial = rules.find((loaded) => loaded.rule.name.toLowerCase().includes(needle));
  if (partial) return partial;

  throw new UserFacingError(`Não encontrei a regra "${query}".`, { code: 'RULE_NOT_FOUND' });
}

/** Opções do autocomplete de `<regra>`: no máximo 25, como o Discord exige. */
export function ruleChoices(
  rules: readonly LoadedRule[],
  query: string,
): { name: string; value: string }[] {
  const needle = query.trim().toLowerCase();
  return rules
    .filter(
      (loaded) =>
        needle.length === 0 ||
        loaded.rule.name.toLowerCase().includes(needle) ||
        loaded.rule.type.includes(needle),
    )
    .slice(0, 25)
    .map((loaded) => ({
      name: `${loaded.rule.enabled ? '✔' : '✖'} ${loaded.rule.name} (${loaded.rule.type})`.slice(
        0,
        100,
      ),
      value: loaded.id,
    }));
}
