import { describe, expect, it } from 'vitest';

import { escalationWindows, matchEscalationStep, type EscalationStep } from './escalation';

function step(overrides: Partial<EscalationStep> & Pick<EscalationStep, 'warns'>): EscalationStep {
  return {
    withinDays: 30,
    action: 'timeout',
    durationMs: 600_000,
    ...overrides,
  } as EscalationStep;
}

describe('matchEscalationStep', () => {
  it('dispara quando a contagem bate exatamente no degrau', () => {
    const steps = [step({ warns: 3 })];
    expect(matchEscalationStep(steps, new Map([[30, 3]]))).toBe(steps[0]);
  });

  it('não dispara antes do degrau', () => {
    expect(matchEscalationStep([step({ warns: 3 })], new Map([[30, 2]]))).toBeNull();
  });

  it('não redispara o degrau anterior no warn seguinte', () => {
    // Com degraus em 3 e 5, o quarto warn não pode reaplicar o timeout do 3.
    const steps = [step({ warns: 3 }), step({ warns: 5, action: 'ban', durationMs: undefined })];
    expect(matchEscalationStep(steps, new Map([[30, 4]]))).toBeNull();
  });

  it('dispara o degrau seguinte quando a contagem o alcança', () => {
    const steps = [step({ warns: 3 }), step({ warns: 5, action: 'ban', durationMs: undefined })];
    expect(matchEscalationStep(steps, new Map([[30, 5]]))).toBe(steps[1]);
  });

  it('respeita a janela de cada degrau', () => {
    // 3 warns em 1 dia não existem; 3 warns em 30 dias sim.
    const steps = [step({ warns: 3, withinDays: 1 }), step({ warns: 3, withinDays: 30 })];
    const counts = new Map([
      [1, 1],
      [30, 3],
    ]);
    expect(matchEscalationStep(steps, counts)).toBe(steps[1]);
  });

  it('escolhe o degrau mais severo quando dois batem juntos', () => {
    const steps = [
      step({ warns: 3, withinDays: 7 }),
      step({ warns: 5, withinDays: 30, action: 'kick', durationMs: undefined }),
    ];
    const counts = new Map([
      [7, 3],
      [30, 5],
    ]);
    expect(matchEscalationStep(steps, counts)).toBe(steps[1]);
  });

  it('sem degraus não há escalada', () => {
    expect(matchEscalationStep([], new Map([[30, 10]]))).toBeNull();
  });
});

describe('escalationWindows', () => {
  it('deduplica e ordena as janelas para uma query por janela', () => {
    const steps = [
      step({ warns: 3, withinDays: 30 }),
      step({ warns: 5, withinDays: 7 }),
      step({ warns: 8, withinDays: 30 }),
    ];
    expect(escalationWindows(steps)).toEqual([7, 30]);
  });
});
