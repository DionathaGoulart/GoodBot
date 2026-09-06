import type { AutomodRule, AutomodRuleType } from '@cobot/shared';

/**
 * Regra validada por `AutomodRuleSchema`, junto do `id` da linha do banco. O
 * estreitamento por tipo é feito em `rule` (que é a união discriminada), não
 * neste invólucro.
 */
export interface LoadedRule {
  id: string;
  rule: AutomodRule;
}

/**
 * O que uma regra de mensagem precisa saber. É um objeto simples (e não a
 * `Message` do discord.js) para as regras serem puras e testáveis sem gateway.
 */
export interface MessageContext {
  guildId: string;
  channelId: string;
  userId: string;
  messageId: string;
  content: string;
  mentionedUserIds: readonly string[];
  mentionedRoleIds: readonly string[];
  mentionsEveryone: boolean;
  /** Quem pode mencionar `@everyone` nativamente não é punido por isso. */
  canMentionEveryone: boolean;
  timestamp: number;
  /** `messageUpdate`: a janela do anti-spam não conta edições. */
  isEdit: boolean;
}

/** Retorno de uma regra que disparou. `reason` vai para o caso e para o log. */
export interface Violation {
  reason: string;
  /** Detalhe técnico do disparo (o que casou), só para o mod-log. */
  detail?: string;
}

export interface RuleCheckInput<T extends AutomodRuleType> {
  ctx: MessageContext;
  config: Extract<AutomodRule, { type: T }>['config'];
  /** Chave dos estados em memória (janela de spam, regex compilado). */
  ruleId: string;
  runtime: AutomodRuntime;
}

/** Regra avaliada em `messageCreate`/`messageUpdate`. */
export interface MessageRule<T extends AutomodRuleType = AutomodRuleType> {
  type: T;
  check(input: RuleCheckInput<T>): Violation | null;
}

/** Estado em memória compartilhado pelas regras entre uma mensagem e outra. */
export interface AutomodRuntime {
  spam: SpamTrackerLike;
  words: WordMatcherCacheLike;
}

export interface SpamTrackerLike {
  track(key: string, entry: { at: number; content: string }, windowMs: number): SpamWindow;
  sweep(now: number): void;
  clear(): void;
}

export interface SpamWindow {
  /** Mensagens dentro da janela, incluindo a atual. */
  count: number;
  /** Maior sequência de mensagens idênticas dentro da janela. */
  duplicates: number;
}

export interface WordMatcherCacheLike {
  match(ruleId: string, config: unknown, content: string): string | null;
  forget(ruleId: string): void;
  clear(): void;
}
