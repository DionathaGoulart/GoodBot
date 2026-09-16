import { DAY_MS, SECOND_MS } from '../constants';

/**
 * Relógio de parede no fuso da guild (IANA, ex.: `America/Sao_Paulo`), sem
 * biblioteca de datas. "Hoje 21h" e "sexta 22h" são horas de parede: a conta
 * precisa acontecer no fuso de quem joga, atravessando horário de verão, e
 * não no dia UTC do servidor.
 */

/** Um instante lido no relógio de parede do fuso. `weekday` 0 = domingo. */
export interface LocalDateTime {
  year: number;
  /** 1 a 12. */
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
}

/** Uma data e hora de parede a converter; o dia pode transbordar o mês (32 = dia 1 do seguinte). */
export interface LocalDateTimeInput {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Lança `RangeError` com fuso desconhecido: é o `Intl` quem confere. */
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
 * UTC correspondente.
 *
 * Os offsets de um dia antes e um dia depois cobrem qualquer virada de horário
 * de verão no meio. Na volta do horário (a mesma hora acontece duas vezes)
 * fica a primeira ocorrência. No avanço (a hora não existe) fica o primeiro
 * instante válido depois do buraco, achado por busca binária: uma jogatina
 * das 2h30 num domingo em que o relógio pula das 2h para as 3h começa às 3h.
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

function assertValidDate(at: Date): number {
  const time = at.getTime();
  if (Number.isNaN(time)) throw new RangeError('Data inválida.');
  return time;
}

/** O que o relógio da guild marca no instante `at`. */
export function toLocalDateTime(at: Date, timeZone: string): LocalDateTime {
  const wall = new Date(wallClock(assertValidDate(at), timeZone));
  return {
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth() + 1,
    day: wall.getUTCDate(),
    weekday: wall.getUTCDay(),
    hour: wall.getUTCHours(),
    minute: wall.getUTCMinutes(),
  };
}

/** O instante em que o relógio da guild marca `local`. */
export function fromLocalDateTime(local: LocalDateTimeInput, timeZone: string): Date {
  formatterFor(timeZone);
  const wall = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  return zonedTimeToUtc(wall, timeZone);
}

/**
 * `at` mais `days` dias de calendário, mantendo a hora de parede: "repetir na
 * semana que vem" continua às 21h mesmo quando o horário de verão muda no meio.
 */
export function addLocalDays(at: Date, days: number, timeZone: string): Date {
  const local = toLocalDateTime(at, timeZone);
  return fromLocalDateTime({ ...local, day: local.day + days }, timeZone);
}
