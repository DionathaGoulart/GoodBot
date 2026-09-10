import { MAX_MESSAGE_CONTENT_LENGTH } from '@goodbot/shared';
import safeRegex from 'safe-regex2';

import { childLogger } from '../../logger';
import { escapeRegex, normalizeText, WORD_END, WORD_START } from '../text';

import type { MessageRule, WordMatcherCacheLike } from '../types';
import type { WordsRuleConfigSchema } from '@goodbot/shared';
import type { z } from 'zod';

const log = childLogger('automod:words');

export type WordsRuleConfig = z.infer<typeof WordsRuleConfigSchema>;

/**
 * Teto do texto entregue a um regex do usuário. É o "timeout" possível sem
 * worker: com entrada limitada e padrão aprovado pelo `safe-regex2`, o tempo
 * de execução fica limitado (PRD §7.3).
 */
export const MAX_REGEX_INPUT_LENGTH = MAX_MESSAGE_CONTENT_LENGTH;

export interface WordMatcher {
  /** Devolve o termo que casou, ou `null`. */
  match(content: string): string | null;
  /** Padrões recusados pelo `safe-regex2` (nunca são executados). */
  rejected: string[];
}

interface NormalizeFlags {
  caseSensitive: boolean;
  normalizeDiacritics: boolean;
}

function literalRegex(patterns: string[], flags: NormalizeFlags): RegExp | null {
  if (patterns.length === 0) return null;
  const body = patterns.join('|');
  return new RegExp(`${WORD_START}(?:${body})${WORD_END}`, flags.caseSensitive ? 'u' : 'iu');
}

/** `*` = qualquer sequência sem espaço; `?` = um caractere sem espaço. */
function wildcardToSource(pattern: string): string {
  return escapeRegex(pattern).replace(/\\\*/g, '\\S*').replace(/\\\?/g, '\\S');
}

/**
 * Compila a lista de uma vez. Chamado no máximo uma vez por versão do config
 * da regra: compilar 500 padrões a cada mensagem custaria caro demais.
 */
export function compileWordMatcher(config: WordsRuleConfig): WordMatcher {
  const flags: NormalizeFlags = {
    caseSensitive: config.caseSensitive,
    normalizeDiacritics: config.normalizeDiacritics,
  };
  const normalize = (value: string): string => normalizeText(value, flags);

  if (config.mode !== 'regex') {
    const sources = config.words.map((word) =>
      config.mode === 'wildcard' ? wildcardToSource(normalize(word)) : escapeRegex(normalize(word)),
    );
    const compiled = literalRegex(sources, flags);
    return {
      rejected: [],
      match(content) {
        return compiled?.exec(normalize(content))?.[0] ?? null;
      },
    };
  }

  const rejected: string[] = [];
  const patterns: RegExp[] = [];
  for (const pattern of config.words) {
    // Padrão com backtracking exponencial nunca é compilado (PRD §7.3).
    if (!safeRegex(pattern)) {
      rejected.push(pattern);
      continue;
    }
    try {
      patterns.push(new RegExp(pattern, config.caseSensitive ? 'u' : 'iu'));
    } catch {
      rejected.push(pattern);
    }
  }
  if (rejected.length > 0) {
    log.warn({ rejected }, 'padrões de regex recusados pelo filtro de palavras');
  }

  return {
    rejected,
    match(content) {
      const raw = content.slice(0, MAX_REGEX_INPUT_LENGTH);
      // Com `normalizeDiacritics`, `palavrao` também pega `palavrão`.
      const folded = config.normalizeDiacritics ? normalize(raw) : null;
      for (const pattern of patterns) {
        const hit = pattern.exec(raw)?.[0] ?? (folded ? (pattern.exec(folded)?.[0] ?? null) : null);
        if (hit) return hit;
      }
      return null;
    },
  };
}

interface CacheEntry {
  fingerprint: string;
  matcher: WordMatcher;
}

/** Um matcher compilado por regra, refeito só quando o config muda. */
export class WordMatcherCache implements WordMatcherCacheLike {
  private readonly entries = new Map<string, CacheEntry>();

  get(ruleId: string, config: WordsRuleConfig): WordMatcher {
    const fingerprint = JSON.stringify(config);
    const cached = this.entries.get(ruleId);
    if (cached && cached.fingerprint === fingerprint) return cached.matcher;

    const matcher = compileWordMatcher(config);
    this.entries.set(ruleId, { fingerprint, matcher });
    return matcher;
  }

  match(ruleId: string, config: unknown, content: string): string | null {
    return this.get(ruleId, config as WordsRuleConfig).match(content);
  }

  forget(ruleId: string): void {
    this.entries.delete(ruleId);
  }

  clear(): void {
    this.entries.clear();
  }
}

export const wordsRule: MessageRule<'words'> = {
  type: 'words',
  check({ ctx, config, ruleId, runtime }) {
    const hit = runtime.words.match(ruleId, config, ctx.content);
    if (!hit) return null;
    return { reason: 'Uso de palavra proibida.', detail: hit };
  },
};
