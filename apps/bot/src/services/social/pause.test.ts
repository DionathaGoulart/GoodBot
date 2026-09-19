import { HOUR_MS, MINUTE_MS, SOCIAL_MAX_FAILURES } from '@goodbot/shared';
import { describe, expect, it } from 'vitest';

import { isSocialPaused, socialPauseMs } from './pause';

describe('socialPauseMs', () => {
  it('abaixo do teto não pausa: a próxima passada tenta de novo', () => {
    expect(socialPauseMs(0)).toBeNull();
    expect(socialPauseMs(SOCIAL_MAX_FAILURES - 1)).toBeNull();
  });

  it('começa em 15 min no teto e dobra a cada falha seguinte', () => {
    expect(socialPauseMs(SOCIAL_MAX_FAILURES)).toBe(15 * MINUTE_MS);
    expect(socialPauseMs(SOCIAL_MAX_FAILURES + 1)).toBe(30 * MINUTE_MS);
    expect(socialPauseMs(SOCIAL_MAX_FAILURES + 2)).toBe(HOUR_MS);
  });

  it('para em 1 h, por maior que seja o contador', () => {
    // Uma falha de 8 h (a noite do feed em 404) não pode custar mais de 1 h de
    // atraso depois de acabar: era 4 h com o teto antigo, de 6 h.
    expect(socialPauseMs(SOCIAL_MAX_FAILURES + 3)).toBe(HOUR_MS);
    expect(socialPauseMs(SOCIAL_MAX_FAILURES + 40)).toBe(HOUR_MS);
    expect(socialPauseMs(Number.MAX_SAFE_INTEGER)).toBe(HOUR_MS);
  });
});

describe('isSocialPaused', () => {
  const now = Date.parse('2026-09-14T12:00:00Z');

  it('sem pausa marcada, a conta roda', () => {
    expect(isSocialPaused(null, now)).toBe(false);
  });

  it('pausa no futuro segura a conta; pausa vencida a libera', () => {
    expect(isSocialPaused(new Date(now + 1), now)).toBe(true);
    expect(isSocialPaused(new Date(now), now)).toBe(false);
    expect(isSocialPaused(new Date(now - MINUTE_MS), now)).toBe(false);
  });
});
