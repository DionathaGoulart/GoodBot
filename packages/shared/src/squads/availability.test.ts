import { describe, expect, it } from 'vitest';

import {
  bestSlot,
  cellBit,
  countCells,
  fromBits,
  nextSessionAt,
  overlap,
  toBits,
} from './availability';
import { DEFAULT_SQUAD_BLOCKS } from '../config/squads';
import { SQUAD_AVAILABILITY_MAX } from '../constants';

const SAO_PAULO = 'America/Sao_Paulo';
const NEW_YORK = 'America/New_York';
const [MORNING, AFTERNOON, EVENING, NIGHT] = [0, 1, 2, 3];
const [SUNDAY, WEDNESDAY, SATURDAY] = [0, 3, 6];

const iso = (window: { startsAt: Date; endsAt: Date }) => ({
  startsAt: window.startsAt.toISOString(),
  endsAt: window.endsAt.toISOString(),
});

describe('toBits / fromBits', () => {
  it('bit = dia * 4 + faixa, com domingo de manhã no bit 0', () => {
    expect(cellBit(SUNDAY, MORNING)).toBe(0);
    expect(cellBit(SATURDAY, NIGHT)).toBe(27);
    expect(toBits([{ day: SATURDAY, block: NIGHT }])).toBe(2 ** 27);
    expect(toBits([])).toBe(0);
  });

  it('ida e volta preserva a grade, em ordem de bit', () => {
    const cells = [
      { day: SATURDAY, block: EVENING },
      { day: SUNDAY, block: NIGHT },
      { day: WEDNESDAY, block: AFTERNOON },
    ];
    const mask = toBits(cells);
    expect(fromBits(mask)).toEqual([
      { day: SUNDAY, block: NIGHT },
      { day: WEDNESDAY, block: AFTERNOON },
      { day: SATURDAY, block: EVENING },
    ]);
    for (const value of [0, 1, 0b1010_0110, SQUAD_AVAILABILITY_MAX]) {
      expect(toBits(fromBits(value))).toBe(value);
    }
    expect(fromBits(SQUAD_AVAILABILITY_MAX)).toHaveLength(28);
  });

  it('célula repetida conta uma vez', () => {
    expect(
      toBits([
        { day: 1, block: 1 },
        { day: 1, block: 1 },
      ]),
    ).toBe(2 ** 5);
  });

  it('recusa célula ou máscara fora da grade', () => {
    for (const cell of [
      { day: 7, block: 0 },
      { day: 0, block: 4 },
      { day: -1, block: 0 },
      { day: 1.5, block: 0 },
    ]) {
      expect(() => toBits([cell])).toThrow(RangeError);
    }
    expect(() => fromBits(SQUAD_AVAILABILITY_MAX + 1)).toThrow(RangeError);
    expect(() => fromBits(-1)).toThrow(RangeError);
  });
});

describe('overlap e countCells', () => {
  it('devolve só as células em comum', () => {
    const a = toBits([
      { day: 5, block: EVENING },
      { day: SATURDAY, block: EVENING },
    ]);
    const b = toBits([
      { day: SATURDAY, block: EVENING },
      { day: SUNDAY, block: MORNING },
    ]);
    expect(overlap(a, b)).toBe(toBits([{ day: SATURDAY, block: EVENING }]));
    expect(countCells(overlap(a, b))).toBe(1);
    expect(overlap(a, 0)).toBe(0);
    expect(countCells(SQUAD_AVAILABILITY_MAX)).toBe(28);
  });
});

describe('bestSlot', () => {
  it('escolhe a célula com mais gente', () => {
    const friday = toBits([{ day: 5, block: EVENING }]);
    const saturday = toBits([{ day: SATURDAY, block: EVENING }]);
    expect(bestSlot([friday | saturday, saturday, friday | saturday])).toEqual({
      day: SATURDAY,
      block: EVENING,
      count: 3,
    });
  });

  it('empate fica com o bit mais baixo, em qualquer ordem', () => {
    const wednesday = toBits([{ day: WEDNESDAY, block: NIGHT }]);
    const sunday = toBits([{ day: SUNDAY, block: AFTERNOON }]);
    const expected = { day: SUNDAY, block: AFTERNOON, count: 1 };
    expect(bestSlot([wednesday, sunday])).toEqual(expected);
    expect(bestSlot([sunday, wednesday])).toEqual(expected);
  });

  it('sem nenhuma célula marcada não há janela', () => {
    expect(bestSlot([])).toBeNull();
    expect(bestSlot([0, 0])).toBeNull();
  });
});

describe('nextSessionAt', () => {
  it('conta no fuso da guild, não no dia UTC', () => {
    // Sábado 23h em São Paulo já é domingo 2h em UTC.
    const from = new Date('2026-09-20T02:00:00Z');
    expect(iso(nextSessionAt(SUNDAY, MORNING, DEFAULT_SQUAD_BLOCKS, SAO_PAULO, from))).toEqual({
      startsAt: '2026-09-20T09:00:00.000Z',
      endsAt: '2026-09-20T15:00:00.000Z',
    });
  });

  it('atravessa a virada da semana: de sábado à noite para a madrugada de domingo', () => {
    const from = new Date('2026-09-20T02:00:00Z');
    expect(iso(nextSessionAt(SUNDAY, NIGHT, DEFAULT_SQUAD_BLOCKS, SAO_PAULO, from))).toEqual({
      startsAt: '2026-09-20T03:00:00.000Z',
      endsAt: '2026-09-20T09:00:00.000Z',
    });
  });

  it('acha o dia certo mais adiante na semana', () => {
    // Segunda 9h em São Paulo; quarta à tarde é 12h às 18h (UTC-3).
    const from = new Date('2026-09-14T12:00:00Z');
    expect(iso(nextSessionAt(WEDNESDAY, AFTERNOON, DEFAULT_SQUAD_BLOCKS, SAO_PAULO, from))).toEqual(
      {
        startsAt: '2026-09-16T15:00:00.000Z',
        endsAt: '2026-09-16T21:00:00.000Z',
      },
    );
  });

  it('devolve a sessão em andamento e só pula de semana quando ela termina', () => {
    const during = new Date('2026-09-20T13:00:00Z');
    expect(
      iso(nextSessionAt(SUNDAY, MORNING, DEFAULT_SQUAD_BLOCKS, SAO_PAULO, during)).startsAt,
    ).toBe('2026-09-20T09:00:00.000Z');
    const atTheEnd = new Date('2026-09-20T15:00:00Z');
    expect(iso(nextSessionAt(SUNDAY, MORNING, DEFAULT_SQUAD_BLOCKS, SAO_PAULO, atTheEnd))).toEqual({
      startsAt: '2026-09-27T09:00:00.000Z',
      endsAt: '2026-09-27T15:00:00.000Z',
    });
  });

  it('endHour 24 termina à meia-noite do dia seguinte', () => {
    const noon = new Date('2026-09-19T15:00:00Z');
    const window = {
      startsAt: '2026-09-19T21:00:00.000Z',
      endsAt: '2026-09-20T03:00:00.000Z',
    };
    expect(iso(nextSessionAt(SATURDAY, EVENING, DEFAULT_SQUAD_BLOCKS, SAO_PAULO, noon))).toEqual(
      window,
    );
    const lateNight = new Date('2026-09-20T02:30:00Z');
    expect(
      iso(nextSessionAt(SATURDAY, EVENING, DEFAULT_SQUAD_BLOCKS, SAO_PAULO, lateNight)),
    ).toEqual(window);
  });

  it('mantém o horário de parede quando o horário de verão muda entre hoje e a sessão', () => {
    // Domingo 1º de março de 2026, 19h EST; a manhã seguinte de domingo já é EDT.
    const from = new Date('2026-03-02T00:00:00Z');
    expect(iso(nextSessionAt(SUNDAY, MORNING, DEFAULT_SQUAD_BLOCKS, NEW_YORK, from))).toEqual({
      startsAt: '2026-03-08T10:00:00.000Z',
      endsAt: '2026-03-08T16:00:00.000Z',
    });
  });

  it('avanço do horário de verão: hora que não existe começa no primeiro instante válido', () => {
    // 8 de março de 2026: em Nova York o relógio pula das 2h para as 3h.
    const blocks = DEFAULT_SQUAD_BLOCKS.map((block, index) =>
      index === NIGHT ? { ...block, startHour: 2, endHour: 5 } : block,
    );
    const from = new Date('2026-03-07T17:00:00Z');
    expect(iso(nextSessionAt(SUNDAY, NIGHT, blocks, NEW_YORK, from))).toEqual({
      startsAt: '2026-03-08T07:00:00.000Z',
      endsAt: '2026-03-08T09:00:00.000Z',
    });
    // A madrugada padrão (0h às 6h) desse domingo dura só cinco horas.
    expect(iso(nextSessionAt(SUNDAY, NIGHT, DEFAULT_SQUAD_BLOCKS, NEW_YORK, from))).toEqual({
      startsAt: '2026-03-08T05:00:00.000Z',
      endsAt: '2026-03-08T10:00:00.000Z',
    });
  });

  it('volta do horário de verão: hora repetida fica com a primeira ocorrência', () => {
    // 1º de novembro de 2026: em Nova York a 1h acontece duas vezes (EDT, depois EST).
    const blocks = DEFAULT_SQUAD_BLOCKS.map((block, index) =>
      index === NIGHT ? { ...block, startHour: 1, endHour: 3 } : block,
    );
    const from = new Date('2026-10-31T16:00:00Z');
    expect(iso(nextSessionAt(SUNDAY, NIGHT, blocks, NEW_YORK, from))).toEqual({
      startsAt: '2026-11-01T05:00:00.000Z',
      endsAt: '2026-11-01T08:00:00.000Z',
    });
    expect(iso(nextSessionAt(SUNDAY, NIGHT, DEFAULT_SQUAD_BLOCKS, NEW_YORK, from))).toEqual({
      startsAt: '2026-11-01T04:00:00.000Z',
      endsAt: '2026-11-01T11:00:00.000Z',
    });
  });

  it('recusa célula, faixa, data ou fuso inválidos', () => {
    const from = new Date('2026-09-14T12:00:00Z');
    expect(() => nextSessionAt(7, MORNING, DEFAULT_SQUAD_BLOCKS, SAO_PAULO, from)).toThrow(
      RangeError,
    );
    expect(() =>
      nextSessionAt(SUNDAY, NIGHT, DEFAULT_SQUAD_BLOCKS.slice(0, 3), SAO_PAULO, from),
    ).toThrow(RangeError);
    expect(() =>
      nextSessionAt(SUNDAY, MORNING, DEFAULT_SQUAD_BLOCKS, SAO_PAULO, new Date('x')),
    ).toThrow(RangeError);
    expect(() =>
      nextSessionAt(SUNDAY, MORNING, DEFAULT_SQUAD_BLOCKS, 'Marte/Olympus', from),
    ).toThrow(RangeError);
  });
});
