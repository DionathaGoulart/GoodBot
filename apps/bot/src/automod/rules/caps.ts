import type { MessageRule } from '../types';

const LETTER = /\p{L}/gu;
const UPPERCASE = /\p{Lu}/gu;

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

/** % de maiúsculas entre as letras (mensagem sem letra nenhuma → 0). */
export function capsPercent(content: string): number {
  const letters = countMatches(content, LETTER);
  if (letters === 0) return 0;
  return Math.round((countMatches(content, UPPERCASE) / letters) * 100);
}

export const capsRule: MessageRule<'caps'> = {
  type: 'caps',
  check({ ctx, config }) {
    const letters = countMatches(ctx.content, LETTER);
    // Mensagem curta em caixa alta (`OK`, `SIM`) não é gritaria.
    if (letters < config.minLength) return null;

    const percent = capsPercent(ctx.content);
    if (percent < config.minPercent) return null;

    return {
      reason: `Excesso de letras maiúsculas (${percent}%).`,
      detail: `${percent}% de ${letters} letras`,
    };
  },
};
