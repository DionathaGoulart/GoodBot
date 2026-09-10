import { capsRule } from './caps';
import { linksRule } from './links';
import { mentionsRule } from './mentions';
import { spamRule } from './spam';
import { wordsRule } from './words';

import type { MessageRule } from '../types';
import type { AutomodRuleType } from '@goodbot/shared';

export { capsRule, linksRule, mentionsRule, spamRule, wordsRule };
export { SpamTracker } from './spam';
export { WordMatcherCache, compileWordMatcher } from './words';

/**
 * Regras avaliadas em mensagem. `raid` não entra aqui: ela roda em
 * `guildMemberAdd` e vive em `raid.ts`.
 */
export const MESSAGE_RULES: {
  readonly [T in Exclude<AutomodRuleType, 'raid'>]: MessageRule<T>;
} = {
  spam: spamRule,
  links: linksRule,
  caps: capsRule,
  words: wordsRule,
  mentions: mentionsRule,
};

export function isMessageRuleType(type: AutomodRuleType): type is Exclude<AutomodRuleType, 'raid'> {
  return type !== 'raid';
}
