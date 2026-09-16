import {
  SQUAD_AVAILABILITY_MAX,
  SQUAD_BLOCKS,
  SQUAD_CELLS,
  SQUAD_DAYS,
} from '../constants';

/**
 * Grade de disponibilidade como máscara de bits. Uma célula é um dia
 * (0 = domingo até 6 = sábado) e uma faixa (índice em `SQUAD_BLOCKS`); o bit
 * dela é `dia * 4 + faixa`. Uma máscara cabe num `integer` e cruzar duas
 * agendas vira um `&`, que é o que o matcher faz milhares de vezes por passada.
 */

export interface SquadCell {
  day: number;
  block: number;
}

/** Uma célula e quantas máscaras a têm marcada. */
export interface SquadSlot extends SquadCell {
  count: number;
}

const BLOCK_COUNT = SQUAD_BLOCKS.length;

function assertCell(day: number, block: number): void {
  if (
    !Number.isInteger(day) ||
    day < 0 ||
    day >= SQUAD_DAYS ||
    !Number.isInteger(block) ||
    block < 0 ||
    block >= BLOCK_COUNT
  ) {
    throw new RangeError(`Célula fora da grade: dia ${String(day)}, faixa ${String(block)}.`);
  }
}

function assertMask(mask: number): void {
  if (!Number.isInteger(mask) || mask < 0 || mask > SQUAD_AVAILABILITY_MAX) {
    throw new RangeError(`Máscara de disponibilidade inválida: ${String(mask)}.`);
  }
}

/** O bit de uma célula. Lança `RangeError` fora da grade. */
export function cellBit(day: number, block: number): number {
  assertCell(day, block);
  return day * BLOCK_COUNT + block;
}

/** Células marcadas → máscara. Célula repetida conta uma vez. */
export function toBits(cells: Iterable<SquadCell>): number {
  let mask = 0;
  for (const { day, block } of cells) mask |= 1 << cellBit(day, block);
  return mask;
}

/** Máscara → células marcadas, na ordem dos bits (domingo de manhã primeiro). */
export function fromBits(mask: number): SquadCell[] {
  assertMask(mask);
  const cells: SquadCell[] = [];
  for (let bit = 0; bit < SQUAD_CELLS; bit++) {
    if (mask & (1 << bit))
      cells.push({ day: Math.floor(bit / BLOCK_COUNT), block: bit % BLOCK_COUNT });
  }
  return cells;
}

/**
 * As células que as duas grades têm em comum, como máscara. Não valida as
 * entradas: é o laço quente do matcher, e as grades já passaram pelo Zod.
 */
export function overlap(a: number, b: number): number {
  return a & b;
}

/** Quantas células uma máscara tem marcadas. */
export function countCells(mask: number): number {
  let count = 0;
  for (let rest = mask; rest !== 0; rest &= rest - 1) count++;
  return count;
}

/**
 * A célula marcada pelo maior número de máscaras; empate fica com o bit mais
 * baixo, para o resultado não depender da ordem das máscaras. `null` quando
 * nenhuma célula está marcada.
 */
export function bestSlot(masks: readonly number[]): SquadSlot | null {
  let best: SquadSlot | null = null;
  for (let bit = 0; bit < SQUAD_CELLS; bit++) {
    let count = 0;
    for (const mask of masks) if (mask & (1 << bit)) count++;
    if (count > 0 && (best === null || count > best.count)) {
      best = { day: Math.floor(bit / BLOCK_COUNT), block: bit % BLOCK_COUNT, count };
    }
  }
  return best;
}
