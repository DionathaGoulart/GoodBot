import { describe, expect, it } from 'vitest';

import { ScheduleSessionInputSchema } from './agenda';

describe('ScheduleSessionInputSchema', () => {
  it('vagas vazias ficam para o config e nota vazia vira null', () => {
    expect(
      ScheduleSessionInputSchema.parse({
        when: ' hoje 21h ',
        slots: ' ',
        note: '',
        visibility: 'open',
      }),
    ).toEqual({ when: 'hoje 21h', slots: undefined, note: null, visibility: 'open' });
  });

  it('lê vagas como número na faixa', () => {
    const parsed = ScheduleSessionInputSchema.parse({
      when: 'sex 22h',
      slots: '6',
      note: 'dificuldade 10',
      visibility: 'closed',
    });
    expect(parsed.slots).toBe(6);
    expect(parsed.note).toBe('dificuldade 10');
  });

  it.each(['1', '11', 'quatro', '2.5'])('recusa vagas %s', (slots) => {
    const result = ScheduleSessionInputSchema.safeParse({
      when: 'hoje 21h',
      slots,
      note: '',
      visibility: 'open',
    });
    expect(result.success).toBe(false);
  });

  it('recusa quando vazio, nota longa e visibilidade desconhecida', () => {
    const base = { when: 'hoje 21h', slots: '', note: '', visibility: 'open' };
    expect(ScheduleSessionInputSchema.safeParse({ ...base, when: '  ' }).success).toBe(false);
    expect(ScheduleSessionInputSchema.safeParse({ ...base, note: 'x'.repeat(201) }).success).toBe(
      false,
    );
    expect(ScheduleSessionInputSchema.safeParse({ ...base, visibility: 'secreta' }).success).toBe(
      false,
    );
  });
});
