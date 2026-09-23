import { describe, expect, it } from 'vitest';

import { describeWhen, MAX_WHEN_AHEAD_DAYS, parseWhen } from './when';
import { UserFacingError } from '../errors';

const SAO_PAULO = 'America/Sao_Paulo';
const NEW_YORK = 'America/New_York';

/** Segunda-feira, 14/09/2026, 9h em São Paulo. */
const MONDAY_9AM = new Date('2026-09-14T12:00:00Z');

const parse = (input: string, now = MONDAY_9AM, timeZone = SAO_PAULO) =>
  parseWhen(input, now, timeZone).toISOString();

function errorOf(input: string, now = MONDAY_9AM): UserFacingError {
  try {
    parseWhen(input, now, SAO_PAULO);
  } catch (error) {
    if (error instanceof UserFacingError) return error;
    throw error;
  }
  throw new Error(`"${input}" deveria ter falhado`);
}

describe('parseWhen', () => {
  it('agora não marca jogatina: aponta o canal de criar', () => {
    for (const input of ['agora', '  AGORA ', 'já', 'agora 21h']) {
      const error = errorOf(input);
      expect(error.code).toBe('WHEN_NOW');
      expect(error.message).toContain('Criar Squad');
    }
  });

  it.each([
    ['hoje 21h', '2026-09-15T00:00:00.000Z'],
    ['hoje 21:30', '2026-09-15T00:30:00.000Z'],
    ['hoje 21h30', '2026-09-15T00:30:00.000Z'],
    ['hoje às 21h', '2026-09-15T00:00:00.000Z'],
    ['21h', '2026-09-15T00:00:00.000Z'],
    ['21', '2026-09-15T00:00:00.000Z'],
    ['21h hoje', '2026-09-15T00:00:00.000Z'],
    ['hoje 23h59', '2026-09-15T02:59:00.000Z'],
  ])('hoje: %s', (input, expected) => {
    expect(parse(input)).toBe(expected);
  });

  it.each([
    ['amanhã 20h', '2026-09-15T23:00:00.000Z'],
    ['amanha 20:30', '2026-09-15T23:30:00.000Z'],
    ['AMANHÃ ÀS 20H', '2026-09-15T23:00:00.000Z'],
    ['depois de amanhã 21h', '2026-09-17T00:00:00.000Z'],
    ['amanhã meio-dia', '2026-09-15T15:00:00.000Z'],
  ])('amanhã: %s', (input, expected) => {
    expect(parse(input)).toBe(expected);
  });

  it.each([
    ['sex 22h', '2026-09-19T01:00:00.000Z'],
    ['sexta 22h', '2026-09-19T01:00:00.000Z'],
    ['sexta-feira 22h', '2026-09-19T01:00:00.000Z'],
    ['dom 15h', '2026-09-20T18:00:00.000Z'],
    ['sáb 21h', '2026-09-20T00:00:00.000Z'],
    ['terça 20h', '2026-09-15T23:00:00.000Z'],
  ])('dia da semana: %s', (input, expected) => {
    expect(parse(input)).toBe(expected);
  });

  it('o dia da semana de hoje vale hoje se a hora não passou, e a semana que vem se passou', () => {
    expect(parse('seg 21h')).toBe('2026-09-15T00:00:00.000Z');
    expect(parse('segunda 8h')).toBe('2026-09-21T11:00:00.000Z');
  });

  it('data com e sem ano', () => {
    expect(parse('16/09 21h')).toBe('2026-09-17T00:00:00.000Z');
    expect(parse('16/9/2026 21h30')).toBe('2026-09-17T00:30:00.000Z');
    expect(parse('20/09/26 15h')).toBe('2026-09-20T18:00:00.000Z');
  });

  it('data sem ano que já passou é a do ano que vem, se couber no prazo', () => {
    const december = new Date('2026-12-20T12:00:00Z');
    expect(parse('02/01 21h', december)).toBe('2027-01-03T00:00:00.000Z');
    expect(errorOf('13/09 21h').code).toBe('WHEN_PAST');
  });

  it('horário de hoje que já passou, mesmo por minutos, sugere o de amanhã', () => {
    expect(parse('hoje 9h01')).toBe('2026-09-14T12:01:00.000Z');
    expect(errorOf('hoje 9h').code).toBe('WHEN_PAST');
    const past = errorOf('hoje 8h50');
    expect(past.code).toBe('WHEN_PAST');
    expect(past.message).toContain('amanhã 8:50');
    expect(errorOf('hoje meia-noite').code).toBe('WHEN_PAST');
  });

  it('recusa o que não entende, com exemplos', () => {
    for (const input of ['', 'xyz', 'hoje amanhã 21h', '21h 22h', 'sexta que vem']) {
      const error = errorOf(input);
      expect(error.code).toBe('INVALID_WHEN');
      expect(error.message).toMatch(/hoje 21h/);
    }
    expect(errorOf('hoje').message).toMatch(/Faltou o horário/);
    expect(errorOf('25h').message).toMatch(/Horário inválido/);
    expect(errorOf('hoje 21:75').message).toMatch(/Horário inválido/);
    expect(errorOf('31/02 21h').message).toMatch(/não existe/);
  });

  it(`recusa mais de ${String(MAX_WHEN_AHEAD_DAYS)} dias adiante`, () => {
    expect(errorOf('01/12 21h').code).toBe('WHEN_TOO_FAR');
  });

  it('conta no fuso da guild', () => {
    expect(parse('hoje 21h', MONDAY_9AM, NEW_YORK)).toBe('2026-09-15T01:00:00.000Z');
  });
});

describe('describeWhen', () => {
  it('hoje, amanhã e o resto com dia da semana e data', () => {
    const at = (iso: string) => describeWhen(new Date(iso), MONDAY_9AM, SAO_PAULO);
    expect(at('2026-09-15T00:00:00Z')).toBe('hoje às 21:00');
    expect(at('2026-09-15T23:30:00Z')).toBe('amanhã às 20:30');
    expect(at('2026-09-19T01:00:00Z')).toBe('sexta 18/09 às 22:00');
  });
});
