import { describe, expect, it } from 'vitest';

import {
  bestSlot,
  cellBit,
  countCells,
  fromBits,
  overlap,
  toBits,
} from './availability';
import { SQUAD_AVAILABILITY_MAX } from '../constants';

const [MORNING, AFTERNOON, EVENING, NIGHT] = [0, 1, 2, 3];
const [SUNDAY, WEDNESDAY, SATURDAY] = [0, 3, 6];

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
