import { describe, expect, it } from 'vitest';

import { EVENT_ENTITY_TYPES, ScheduledEventInputSchema, scheduledEventProblems } from './events';

const ACTOR = '200000000000000000';
const CHANNEL = '300000000000000000';

const START = '2026-10-01T18:00:00.000Z';
const END = '2026-10-01T20:00:00.000Z';

function draft(overrides: Record<string, unknown> = {}) {
  return {
    actorId: ACTOR,
    name: 'Noite de perguntas',
    description: '',
    entityType: EVENT_ENTITY_TYPES.voice,
    channelId: CHANNEL,
    location: '',
    scheduledStartAt: START,
    scheduledEndAt: '',
    ...overrides,
  };
}

describe('scheduledEventProblems', () => {
  it('evento em canal de voz só precisa do canal', () => {
    expect(
      scheduledEventProblems({
        entityType: EVENT_ENTITY_TYPES.voice,
        channelId: CHANNEL,
        location: null,
        scheduledStartAt: START,
        scheduledEndAt: null,
      }),
    ).toEqual([]);
  });

  it('evento em canal de voz sem canal é recusado', () => {
    expect(
      scheduledEventProblems({
        entityType: EVENT_ENTITY_TYPES.voice,
        channelId: null,
        location: null,
        scheduledStartAt: START,
        scheduledEndAt: null,
      }),
    ).toEqual([{ field: 'channelId', message: expect.stringContaining('canal') as string }]);
  });

  it('evento externo sem local e sem fim reclama dos dois', () => {
    const problems = scheduledEventProblems({
      entityType: EVENT_ENTITY_TYPES.external,
      channelId: null,
      location: null,
      scheduledStartAt: START,
      scheduledEndAt: null,
    });
    expect(problems.map((problem) => problem.field)).toEqual(['location', 'scheduledEndAt']);
  });

  it('fim antes do início é recusado', () => {
    const problems = scheduledEventProblems({
      entityType: EVENT_ENTITY_TYPES.voice,
      channelId: CHANNEL,
      location: null,
      scheduledStartAt: END,
      scheduledEndAt: START,
    });
    expect(problems).toEqual([
      { field: 'scheduledEndAt', message: 'O fim tem que vir depois do início.' },
    ]);
  });
});

describe('ScheduledEventInputSchema', () => {
  it('aceita um evento de voz completo', () => {
    expect(ScheduledEventInputSchema.safeParse(draft()).success).toBe(true);
  });

  it('recusa evento externo sem local, marcando o campo', () => {
    const parsed = ScheduledEventInputSchema.safeParse(
      draft({ entityType: EVENT_ENTITY_TYPES.external, channelId: '', scheduledEndAt: END }),
    );
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['location']);
  });

  it('evento externo com local e fim passa', () => {
    const parsed = ScheduledEventInputSchema.safeParse(
      draft({
        entityType: EVENT_ENTITY_TYPES.external,
        channelId: '',
        location: 'Praça central',
        scheduledEndAt: END,
      }),
    );
    expect(parsed.success).toBe(true);
  });
});
