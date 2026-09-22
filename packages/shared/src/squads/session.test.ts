import { describe, expect, it } from 'vitest';

import { HOUR_MS, MINUTE_MS } from '../constants';
import { isSessionOver, type SessionEndFields } from './session';

const NOW = Date.parse('2026-09-14T12:00:00Z');
const at = (offsetMs: number) => new Date(NOW + offsetMs);

function session(overrides: Partial<SessionEndFields> = {}): SessionEndFields {
  return { endsAt: at(2 * HOUR_MS), startedAt: null, voiceReleasedAt: null, ...overrides };
}

describe('isSessionOver', () => {
  it.each([
    ['marcada, antes do fim', session(), false],
    ['no minuto do fim previsto', session({ endsAt: at(0) }), true],
    ['depois do fim previsto', session({ endsAt: at(-MINUTE_MS) }), true],
    ['começou e a sala está viva', session({ startedAt: at(-HOUR_MS) }), false],
    [
      'começou e o voice esvaziou (reserva liberada depois do início)',
      session({ startedAt: at(-HOUR_MS), voiceReleasedAt: at(-MINUTE_MS) }),
      true,
    ],
    [
      'a sala não saiu antes do início: joga sem sala até o fim',
      session({ startedAt: at(-HOUR_MS), voiceReleasedAt: at(-2 * HOUR_MS) }),
      false,
    ],
    [
      'liberada antes de começar (remarcação ou sala que não saiu)',
      session({ voiceReleasedAt: at(-MINUTE_MS) }),
      false,
    ],
  ])('%s', (_label, input, expected) => {
    expect(isSessionOver(input, NOW)).toBe(expected);
  });
});
