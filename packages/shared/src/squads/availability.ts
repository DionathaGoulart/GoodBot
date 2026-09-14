import {
  DAY_MS,
  HOUR_MS,
  SECOND_MS,
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

/** O que a conta da próxima sessão precisa de uma faixa do config. */
export interface SquadBlockHours {
  startHour: number;
  endHour: number;
}

export interface SquadSessionWindow {
  startsAt: Date;
  endsAt: Date;
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

// ── Fuso horário ────────────────────────────────────────────────────────────

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * O relógio de parede de um instante no fuso, escrito como se fosse UTC (ms).
 * Comparar dois desses é comparar "que horas o relógio da guild marca".
 */
function wallClock(at: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(at));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    // Algumas ICUs escrevem a meia-noite como 24.
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
}

/** Quanto o fuso está adiantado em relação ao UTC no instante `at`. */
function offsetAt(at: number, timeZone: string): number {
  const floored = Math.floor(at / SECOND_MS) * SECOND_MS;
  return wallClock(floored, timeZone) - floored;
}

/**
 * Converte um relógio de parede (escrito como UTC, ver `wallClock`) no instante
 * UTC correspondente, sem dependência de biblioteca de datas.
 *
 * Os offsets de um dia antes e um dia depois cobrem qualquer virada de horário
 * de verão no meio. Na volta do horário (a mesma hora acontece duas vezes)
 * fica a primeira ocorrência: a sessão começa no primeiro "1h". No avanço (a
 * hora não existe) fica o primeiro instante válido depois do buraco, achado
 * por busca binária: uma sessão das 2h num domingo em que o relógio pula das
 * 2h para as 3h começa às 3h.
 */
function zonedTimeToUtc(wall: number, timeZone: string): Date {
  const before = offsetAt(wall - DAY_MS, timeZone);
  const after = offsetAt(wall + DAY_MS, timeZone);
  const candidates = [...new Set([wall - before, wall - after])]
    .filter((instant) => wallClock(instant, timeZone) === wall)
    .sort((x, y) => x - y);
  if (candidates[0] !== undefined) return new Date(candidates[0]);

  // Buraco: antes da virada o relógio ainda não chegou em `wall`, depois já passou.
  let low = Math.min(wall - before, wall - after);
  let high = Math.max(wall - before, wall - after);
  while (high - low > SECOND_MS) {
    const middle = low + Math.max(SECOND_MS, Math.floor((high - low) / 2 / SECOND_MS) * SECOND_MS);
    if (wallClock(middle, timeZone) >= wall) high = middle;
    else low = middle;
  }
  return new Date(high);
}

/**
 * A primeira ocorrência semanal da janela de um squad (dia + faixa) que ainda
 * não terminou em `from`, no fuso da guild (IANA, ex.: `America/Sao_Paulo`).
 *
 * Uma sessão em andamento é devolvida, com `startsAt` no passado: o job que
 * roda a cada poucos minutos precisa achar a sessão de agora para reservar o
 * voice e mover quem chegou atrasado, não pular para a semana seguinte.
 * `endHour` 24 é a meia-noite do dia seguinte.
 */
export function nextSessionAt(
  day: number,
  block: number,
  blocks: readonly SquadBlockHours[],
  timeZone: string,
  from: Date,
): SquadSessionWindow {
  assertCell(day, block);
  const hours = blocks[block];
  if (!hours || !(hours.startHour < hours.endHour)) {
    throw new RangeError(`Faixa ${String(block)} sem horário válido.`);
  }
  const now = from.getTime();
  if (Number.isNaN(now)) throw new RangeError('Data de referência inválida.');

  const today = new Date(wallClock(now, timeZone));
  const weekday = today.getUTCDay();
  // Começa em ontem por garantia (virada de horário à meia-noite) e vai até a
  // semana seguinte, que sempre tem o dia pedido depois de hoje.
  for (let offset = -1; offset <= SQUAD_DAYS; offset++) {
    if ((weekday + offset + SQUAD_DAYS) % SQUAD_DAYS !== day) continue;
    const date = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset);
    const startsAt = zonedTimeToUtc(date + hours.startHour * HOUR_MS, timeZone);
    const endsAt = zonedTimeToUtc(date + hours.endHour * HOUR_MS, timeZone);
    if (endsAt.getTime() > now) return { startsAt, endsAt };
  }
  throw new Error('nextSessionAt: nenhuma ocorrência em oito dias, o que não deveria acontecer.');
}
