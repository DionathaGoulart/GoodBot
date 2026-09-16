import { DAY_MS, MINUTE_MS } from '../constants';
import { UserFacingError } from '../errors';
import { fromLocalDateTime, toLocalDateTime } from './zoned';

import type { LocalDateTime } from './zoned';

/**
 * O "quando" de uma jogatina, como a pessoa digita no `/bora` ou no modal do
 * botão BORA: `agora`, `hoje 21h`, `amanhã 20:30`, `sex 22h`, `16/09 21h`. A
 * conta é no fuso da guild, porque "21h" é a hora de quem joga.
 *
 * É o ponto de atrito do fluxo: todo erro vira `UserFacingError` com
 * exemplos, para a própria mensagem ensinar o formato.
 */

export const WHEN_EXAMPLES = 'agora, hoje 21h, amanhã 20:30, sex 22h, 16/09 21h';

/**
 * Quanto um horário pode estar no passado e ainda valer. Quem digita
 * `hoje 21h` às 21h05 quer jogar agora, não uma mensagem de erro.
 */
export const WHEN_PAST_GRACE_MS = 15 * MINUTE_MS;

/** Antecedência máxima de uma jogatina. */
export const MAX_WHEN_AHEAD_DAYS = 60;

const WEEKDAYS: Readonly<Record<string, number>> = {
  dom: 0,
  domingo: 0,
  seg: 1,
  segunda: 1,
  ter: 2,
  terca: 2,
  qua: 3,
  quarta: 3,
  qui: 4,
  quinta: 4,
  sex: 5,
  sexta: 5,
  sab: 6,
  sabado: 6,
};

export const WEEKDAY_NAMES = [
  'domingo',
  'segunda',
  'terça',
  'quarta',
  'quinta',
  'sexta',
  'sábado',
] as const;

/** Palavras que só ligam as partes: "hoje às 21h", "sexta de noite às 22". */
const FILLER = new Set(['as', 'a', 'de', 'dia', 'no', 'na', 'em', 'la', 'pelas']);

const TIME_RE = /^(\d{1,2})(?:[:h](\d{2}))?(?:h|hs|hr|hrs)?$/;
const DATE_RE = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/;

type DayPart =
  | { kind: 'offset'; days: number }
  | { kind: 'weekday'; weekday: number }
  | { kind: 'date'; day: number; month: number; year: number | null };

interface TimePart {
  hour: number;
  minute: number;
}

function invalid(message = `Não entendi o horário. Exemplos: ${WHEN_EXAMPLES}.`): UserFacingError {
  return new UserFacingError(message, { code: 'INVALID_WHEN' });
}

/** Minúsculo, sem acento, sem `-feira` e com as expressões de duas palavras juntas. */
function normalize(input: string): string[] {
  const text = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/-feira\b/g, '')
    .replace(/[,.;!?]/g, ' ')
    .replace(/\bdepois\s+de\s+amanha\b/g, 'depoisdeamanha')
    .replace(/\bmeio[\s-]dia\b/g, '12h')
    .replace(/\bmeia[\s-]noite\b/g, '0h')
    .trim();
  return text === '' ? [] : text.split(/\s+/);
}

function dayPart(token: string): DayPart | null {
  if (token === 'hoje') return { kind: 'offset', days: 0 };
  if (token === 'amanha') return { kind: 'offset', days: 1 };
  if (token === 'depoisdeamanha') return { kind: 'offset', days: 2 };
  const weekday = WEEKDAYS[token];
  if (weekday !== undefined) return { kind: 'weekday', weekday };
  const date = DATE_RE.exec(token);
  if (!date) return null;
  const rawYear = date[3];
  return {
    kind: 'date',
    day: Number(date[1]),
    month: Number(date[2]),
    year: rawYear === undefined ? null : rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear),
  };
}

function timePart(token: string): TimePart | null {
  const match = TIME_RE.exec(token);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  if (hour > 23 || minute > 59) throw invalid(`Horário inválido. Exemplos: ${WHEN_EXAMPLES}.`);
  return { hour, minute };
}

/** `16/09` que existe no calendário; `31/02` não. */
function assertCalendarDate(year: number, month: number, day: number): void {
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw invalid(`Essa data não existe. Exemplos: ${WHEN_EXAMPLES}.`);
  }
}

function clockText(time: TimePart): string {
  return time.minute === 0
    ? `${String(time.hour)}h`
    : `${String(time.hour)}:${String(time.minute).padStart(2, '0')}`;
}

function resolve(
  day: DayPart,
  time: TimePart,
  local: LocalDateTime,
  now: number,
  timeZone: string,
): Date {
  const at = (year: number, month: number, date: number) =>
    fromLocalDateTime({ year, month, day: date, ...time }, timeZone);
  const isPast = (date: Date) => date.getTime() < now - WHEN_PAST_GRACE_MS;

  switch (day.kind) {
    case 'offset': {
      const date = at(local.year, local.month, local.day + day.days);
      if (isPast(date)) {
        throw new UserFacingError(
          `Esse horário de hoje já passou. Para amanhã, use amanhã ${clockText(time)}.`,
          { code: 'WHEN_PAST' },
        );
      }
      return date;
    }
    case 'weekday': {
      const ahead = (day.weekday - local.weekday + 7) % 7;
      const date = at(local.year, local.month, local.day + ahead);
      // O dia da semana de hoje com a hora já passada é o da semana que vem.
      return isPast(date) ? at(local.year, local.month, local.day + ahead + 7) : date;
    }
    case 'date': {
      const year = day.year ?? local.year;
      assertCalendarDate(year, day.month, day.day);
      const date = at(year, day.month, day.day);
      if (!isPast(date)) return date;
      // Sem ano, "02/01" digitado em dezembro é o do ano que vem.
      if (day.year === null) {
        assertCalendarDate(year + 1, day.month, day.day);
        const next = at(year + 1, day.month, day.day);
        if (next.getTime() <= now + MAX_WHEN_AHEAD_DAYS * DAY_MS) return next;
      }
      throw new UserFacingError('Essa data já passou.', { code: 'WHEN_PAST' });
    }
  }
}

/**
 * Lê o "quando" de uma jogatina no fuso `timeZone`. `agora` é o minuto atual
 * (dois `/bora agora` no mesmo minuto caem na mesma jogatina); sem dia, vale
 * hoje; dia da semana é o próximo, contando hoje se a hora ainda não passou.
 * Lança `UserFacingError` com exemplos para tudo o que não entender, para
 * horário que já passou e para mais de `MAX_WHEN_AHEAD_DAYS` dias adiante.
 */
export function parseWhen(input: string, now: Date, timeZone: string): Date {
  const nowMs = now.getTime();
  if (Number.isNaN(nowMs)) throw new RangeError('Data de referência inválida.');
  const tokens = normalize(input).filter((token) => !FILLER.has(token));
  if (tokens.length === 0) throw invalid(`Diga quando. Exemplos: ${WHEN_EXAMPLES}.`);

  if (tokens.length === 1 && (tokens[0] === 'agora' || tokens[0] === 'ja')) {
    return new Date(Math.floor(nowMs / MINUTE_MS) * MINUTE_MS);
  }

  let day: DayPart | null = null;
  let time: TimePart | null = null;
  for (const token of tokens) {
    const asDay = dayPart(token);
    if (asDay && !day) {
      day = asDay;
      continue;
    }
    const asTime = asDay ? null : timePart(token);
    if (asTime && !time) {
      time = asTime;
      continue;
    }
    throw invalid();
  }
  if (!time) throw invalid(`Faltou o horário. Exemplos: ${WHEN_EXAMPLES}.`);

  const local = toLocalDateTime(now, timeZone);
  const startsAt = resolve(day ?? { kind: 'offset', days: 0 }, time, local, nowMs, timeZone);
  if (startsAt.getTime() > nowMs + MAX_WHEN_AHEAD_DAYS * DAY_MS) {
    throw new UserFacingError(
      `Dá para marcar com no máximo ${String(MAX_WHEN_AHEAD_DAYS)} dias de antecedência.`,
      { code: 'WHEN_TOO_FAR' },
    );
  }
  return startsAt;
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Um instante como a pessoa lê no fuso da guild: "hoje às 21:00", "amanhã às
 * 20:30", "sexta 18/09 às 22:00". É o eco do autocomplete do `/bora`: quem
 * digita `sex 22h` vê a data antes de enviar.
 */
export function describeWhen(at: Date, now: Date, timeZone: string): string {
  const target = toLocalDateTime(at, timeZone);
  const today = toLocalDateTime(now, timeZone);
  const clock = `${pad(target.hour)}:${pad(target.minute)}`;
  const days = Math.round(
    (Date.UTC(target.year, target.month - 1, target.day) -
      Date.UTC(today.year, today.month - 1, today.day)) /
      DAY_MS,
  );
  if (days === 0) return `hoje às ${clock}`;
  if (days === 1) return `amanhã às ${clock}`;
  const date = `${pad(target.day)}/${pad(target.month)}`;
  return `${WEEKDAY_NAMES[target.weekday] ?? ''} ${date} às ${clock}`;
}

/** Sugestões do autocomplete quando nada foi digitado: todas válidas agora. */
export function suggestWhen(now: Date, timeZone: string): string[] {
  const candidates = ['agora', 'hoje 20h', 'hoje 21h', 'hoje 22h', 'amanhã 21h', 'sex 21h', 'sáb 21h'];
  const seen = new Set<number>();
  const valid: string[] = [];
  for (const candidate of candidates) {
    try {
      const at = parseWhen(candidate, now, timeZone).getTime();
      // "hoje 21h" dentro da tolerância já não é futuro: fica o "agora".
      if (candidate !== 'agora' && at <= now.getTime()) continue;
      if (seen.has(at)) continue;
      seen.add(at);
      valid.push(candidate);
    } catch {
      // Horário de hoje que já passou: fora da lista.
    }
  }
  return valid;
}
