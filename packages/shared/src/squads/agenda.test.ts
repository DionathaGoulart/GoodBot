import { describe, expect, it } from 'vitest';

import { OpenCallInputSchema, ScheduleSessionInputSchema } from './agenda';

describe('ScheduleSessionInputSchema', () => {
  it('vagas vazias ficam para o config e nota vazia vira null', () => {
    expect(ScheduleSessionInputSchema.parse({ when: ' hoje 21h ', slots: ' ', note: '' })).toEqual({
      when: 'hoje 21h',
      slots: undefined,
      note: null,
    });
  });

  it('lê vagas como número na faixa', () => {
    const parsed = ScheduleSessionInputSchema.parse({
      when: 'sex 22h',
      slots: '6',
      note: 'dificuldade 10',
    });
    expect(parsed.slots).toBe(6);
    expect(parsed.note).toBe('dificuldade 10');
  });

  it('não tem visibilidade: a jogatina nasce privada', () => {
    const parsed = ScheduleSessionInputSchema.parse({
      when: 'sex 22h',
      slots: '',
      note: '',
      visibility: 'open',
    });
    expect(parsed).not.toHaveProperty('visibility');
  });

  it.each(['1', '11', 'quatro', '2.5'])('recusa vagas %s', (slots) => {
    const result = ScheduleSessionInputSchema.safeParse({ when: 'hoje 21h', slots, note: '' });
    expect(result.success).toBe(false);
  });

  it('recusa quando vazio e nota longa', () => {
    const base = { when: 'hoje 21h', slots: '', note: '' };
    expect(ScheduleSessionInputSchema.safeParse({ ...base, when: '  ' }).success).toBe(false);
    expect(ScheduleSessionInputSchema.safeParse({ ...base, note: 'x'.repeat(201) }).success).toBe(
      false,
    );
  });
});

describe('OpenCallInputSchema', () => {
  it('lê o quê e as vagas; vagas vazias ficam para o config', () => {
    expect(OpenCallInputSchema.parse({ what: ' D10, missão de 40 min ', slots: '' })).toEqual({
      what: 'D10, missão de 40 min',
      slots: undefined,
    });
    expect(OpenCallInputSchema.parse({ what: 'D10', slots: '3' }).slots).toBe(3);
  });

  it('o quê é obrigatório e tem teto', () => {
    expect(OpenCallInputSchema.safeParse({ what: '   ', slots: '' }).success).toBe(false);
    expect(OpenCallInputSchema.safeParse({ what: 'x'.repeat(201), slots: '' }).success).toBe(false);
    expect(OpenCallInputSchema.safeParse({ what: 'x'.repeat(200), slots: '' }).success).toBe(true);
  });

  it.each(['1', '11', 'dois'])('recusa vagas %s', (slots) => {
    expect(OpenCallInputSchema.safeParse({ what: 'D10', slots }).success).toBe(false);
  });
});
