import { describe, expect, it } from 'vitest';

import { addLocalDays, fromLocalDateTime, toLocalDateTime } from './zoned';

const SAO_PAULO = 'America/Sao_Paulo';
const NEW_YORK = 'America/New_York';

describe('toLocalDateTime', () => {
  it('lê o relógio do fuso, não o dia UTC', () => {
    // Domingo 2h UTC ainda é sábado 23h em São Paulo.
    expect(toLocalDateTime(new Date('2026-09-20T02:00:00Z'), SAO_PAULO)).toEqual({
      year: 2026,
      month: 9,
      day: 19,
      weekday: 6,
      hour: 23,
      minute: 0,
    });
  });

  it('recusa data ou fuso inválidos', () => {
    expect(() => toLocalDateTime(new Date('x'), SAO_PAULO)).toThrow(RangeError);
    expect(() => toLocalDateTime(new Date(), 'Marte/Olympus')).toThrow(RangeError);
  });
});

describe('fromLocalDateTime', () => {
  it('converte a hora de parede no instante UTC', () => {
    expect(
      fromLocalDateTime({ year: 2026, month: 9, day: 20, hour: 6, minute: 0 }, SAO_PAULO),
    ).toEqual(new Date('2026-09-20T09:00:00Z'));
  });

  it('dia que transborda o mês cai no mês seguinte', () => {
    expect(
      fromLocalDateTime({ year: 2026, month: 9, day: 31, hour: 21, minute: 30 }, SAO_PAULO),
    ).toEqual(new Date('2026-10-02T00:30:00Z'));
  });

  it('avanço do horário de verão: hora que não existe vira o primeiro instante válido', () => {
    // 8 de março de 2026: em Nova York o relógio pula das 2h para as 3h.
    expect(
      fromLocalDateTime({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, NEW_YORK),
    ).toEqual(new Date('2026-03-08T07:00:00Z'));
  });

  it('volta do horário de verão: hora repetida fica com a primeira ocorrência', () => {
    // 1º de novembro de 2026: em Nova York a 1h acontece duas vezes (EDT, depois EST).
    expect(
      fromLocalDateTime({ year: 2026, month: 11, day: 1, hour: 1, minute: 0 }, NEW_YORK),
    ).toEqual(new Date('2026-11-01T05:00:00Z'));
  });

  it('recusa fuso inválido', () => {
    expect(() =>
      fromLocalDateTime({ year: 2026, month: 9, day: 20, hour: 6, minute: 0 }, 'Marte/Olympus'),
    ).toThrow(RangeError);
  });
});

describe('addLocalDays', () => {
  it('mantém a hora de parede quando o horário de verão muda no meio', () => {
    // Sábado 7 de março, 21h EST; o sábado seguinte já é EDT.
    expect(addLocalDays(new Date('2026-03-08T02:00:00Z'), 7, NEW_YORK)).toEqual(
      new Date('2026-03-15T01:00:00Z'),
    );
  });

  it('atravessa a virada do mês', () => {
    expect(addLocalDays(new Date('2026-09-26T00:00:00Z'), 7, SAO_PAULO)).toEqual(
      new Date('2026-10-03T00:00:00Z'),
    );
  });
});
