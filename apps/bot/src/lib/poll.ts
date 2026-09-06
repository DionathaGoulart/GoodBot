import { POLL_MAX_OPTIONS, POLL_MIN_OPTIONS } from '@cobot/shared';

import type { PollOption, PollVotes } from '@cobot/db';

/** Largura da barra de resultado em caracteres. */
export const BAR_WIDTH = 12;
const FILLED = '█';
const EMPTY = '░';

export interface PollTally {
  option: PollOption;
  votes: number;
  /** 0–100, arredondado. Base: votos na opção / total de votos dados. */
  percent: number;
  /** `true` para a(s) opção(ões) com mais votos, quando há ao menos um voto. */
  leading: boolean;
}

export interface PollResult {
  tallies: PollTally[];
  /** Votos contados (uma opção marcada = um voto, mesmo em múltipla escolha). */
  totalVotes: number;
  /** Pessoas distintas que votaram. */
  totalVoters: number;
}

/**
 * Apura uma enquete. Votos em opções que não existem mais são ignorados, e a
 * porcentagem é sobre o total de marcações — em múltipla escolha a soma passa
 * de 100% se dividida por votante, o que confunde mais do que informa.
 */
export function tallyPoll(options: readonly PollOption[], votes: PollVotes): PollResult {
  const counts = new Map<string, number>(options.map((option) => [option.id, 0]));
  let totalVotes = 0;
  let totalVoters = 0;

  for (const chosen of Object.values(votes)) {
    let counted = false;
    for (const optionId of new Set(chosen)) {
      const current = counts.get(optionId);
      if (current === undefined) continue;
      counts.set(optionId, current + 1);
      totalVotes += 1;
      counted = true;
    }
    if (counted) totalVoters += 1;
  }

  const max = Math.max(0, ...counts.values());
  const tallies = options.map((option) => {
    const value = counts.get(option.id) ?? 0;
    return {
      option,
      votes: value,
      percent: totalVotes === 0 ? 0 : Math.round((value / totalVotes) * 100),
      leading: max > 0 && value === max,
    };
  });

  return { tallies, totalVotes, totalVoters };
}

/** Barra de texto proporcional: `████░░░░░░░░ 33% (2)`. */
export function formatBar(percent: number, width = BAR_WIDTH): string {
  const clamped = Math.min(100, Math.max(0, percent));
  const filled = Math.round((clamped / 100) * width);
  return FILLED.repeat(filled) + EMPTY.repeat(width - filled);
}

/** Uma linha de resultado por opção, pronta para a descrição do embed. */
export function formatTally(tally: PollTally): string {
  const label = tally.leading ? `**${tally.option.label}**` : tally.option.label;
  const emoji = tally.option.emoji ? `${tally.option.emoji} ` : '';
  return `${emoji}${label}\n\`${formatBar(tally.percent)}\` ${tally.percent}% · ${tally.votes} voto(s)`;
}

/**
 * Quebra as opções digitadas em `opcoes` (separadas por `|`). Rejeita
 * duplicadas porque duas linhas idênticas viram dois botões indistinguíveis.
 */
export function parsePollOptions(raw: string): PollOption[] {
  const labels = raw
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const label of labels) {
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(label);
  }

  if (unique.length < POLL_MIN_OPTIONS || unique.length > POLL_MAX_OPTIONS) return [];
  // O id é o índice: estável enquanto a enquete existir e curto no custom id.
  return unique.map((label, index) => ({ id: String(index), label }));
}
