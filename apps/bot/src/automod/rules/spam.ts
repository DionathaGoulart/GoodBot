import { normalizeText } from '../text';

import type { MessageRule, SpamTrackerLike, SpamWindow } from '../types';

interface Entry {
  at: number;
  content: string;
}

/**
 * Janela deslizante por chave (`regra:usuário[:canal]`). Fica em memória de
 * propósito: é o caminho quente de toda mensagem do servidor e uma ida ao
 * banco por mensagem não caberia na VM de 1 GB (PRD §7.4).
 */
export class SpamTracker implements SpamTrackerLike {
  private readonly entries = new Map<string, Entry[]>();

  track(key: string, entry: Entry, windowMs: number): SpamWindow {
    const since = entry.at - windowMs;
    const kept = (this.entries.get(key) ?? []).filter((item) => item.at > since);
    kept.push(entry);
    this.entries.set(key, kept);

    // Duplicatas contam a sequência mais recente: quebrar o padrão zera.
    let duplicates = 0;
    for (let i = kept.length - 1; i >= 0; i--) {
      if (kept[i]?.content !== entry.content) break;
      duplicates += 1;
    }

    return { count: kept.length, duplicates };
  }

  /** Descarta chaves cujas mensagens já saíram de qualquer janela plausível. */
  sweep(now: number, maxWindowMs = 120_000): void {
    for (const [key, entries] of this.entries) {
      const last = entries[entries.length - 1];
      if (!last || last.at <= now - maxWindowMs) this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export const spamRule: MessageRule<'spam'> = {
  type: 'spam',
  check({ ctx, config, ruleId, runtime }) {
    // Editar uma mensagem antiga não é flood: só `messageCreate` conta.
    if (ctx.isEdit) return null;

    const key = config.perChannel
      ? `${ruleId}:${ctx.userId}:${ctx.channelId}`
      : `${ruleId}:${ctx.userId}`;
    const windowMs = config.intervalSeconds * 1_000;
    const window = runtime.spam.track(
      key,
      { at: ctx.timestamp, content: normalizeText(ctx.content) },
      windowMs,
    );

    if (window.count > config.maxMessages) {
      return {
        reason: `Flood: mais de ${config.maxMessages} mensagens em ${config.intervalSeconds}s.`,
        detail: `${window.count} mensagens na janela`,
      };
    }
    if (config.maxDuplicates > 0 && window.duplicates > config.maxDuplicates) {
      return {
        reason: `Flood: mais de ${config.maxDuplicates} mensagens idênticas seguidas.`,
        detail: `${window.duplicates} mensagens idênticas`,
      };
    }
    return null;
  },
};
