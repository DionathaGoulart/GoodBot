/**
 * Período do dashboard (PRD §6.1) e as transformações de bucket → série.
 *
 * Tudo aqui é puro e sem `server-only` de propósito: o `period-picker` roda no
 * cliente e os testes rodam em jsdom. Quem fala com o banco é `lib/stats.ts`.
 */

export const RANGE_PRESETS = ['7d', '30d', '90d'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const DEFAULT_RANGE: RangePreset = '30d';

/** Retenção de `stat_buckets` (PRD §5.6): pedir mais que isso é pedir vazio. */
export const MAX_RANGE_DAYS = 90;

const PRESET_DAYS: Record<RangePreset, number> = { '7d': 7, '30d': 30, '90d': 90 };

export interface Period {
  /** Início inclusivo — 00:00 do primeiro dia no fuso da guild. */
  from: Date;
  /** Fim exclusivo — 00:00 do dia seguinte ao último. */
  to: Date;
  /** Quantidade de dias inteiros na janela. */
  days: number;
  /** Preset quando veio de uma tag; `null` quando é um intervalo custom. */
  preset: RangePreset | null;
  /** Forma canônica para o `?range=` da URL. */
  value: string;
  /** Fuso da guild que decide onde o dia começa. */
  timezone: string;
}

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

const DAY_MS = 86_400_000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const partsFormatter = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let cached = partsFormatter.get(timezone);
  if (!cached) {
    cached = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatter.set(timezone, cached);
  }
  return cached;
}

/** Quanto o fuso está adiantado em relação ao UTC no instante `at`. */
function offsetMs(at: Date, timezone: string): number {
  const parts = formatter(timezone).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  // `24` aparece em algumas ICUs para a meia-noite; vira `0`.
  const hour = get('hour') % 24;
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** `YYYY-MM-DD` do instante no fuso da guild. */
export function zonedDay(at: Date, timezone = DEFAULT_TIMEZONE): string {
  const parts = formatter(timezone).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Instante UTC da meia-noite de `day` no fuso da guild. */
export function zonedDayStart(day: string, timezone = DEFAULT_TIMEZONE): Date {
  const utcGuess = new Date(`${day}T00:00:00.000Z`);
  // Duas passadas: a primeira erra por uma hora quando o dia começa dentro de
  // uma virada de horário de verão; a segunda corrige com o offset certo.
  const first = new Date(utcGuess.getTime() - offsetMs(utcGuess, timezone));
  return new Date(utcGuess.getTime() - offsetMs(first, timezone));
}

/** Soma dias a um `YYYY-MM-DD` (aritmética de calendário, não de instante). */
export function addDays(day: string, amount: number): string {
  const shifted = new Date(`${day}T00:00:00.000Z`).getTime() + amount * DAY_MS;
  return new Date(shifted).toISOString().slice(0, 10);
}

function isValidDay(day: string): boolean {
  if (!DAY_PATTERN.test(day)) return false;
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(day);
}

function presetPeriod(preset: RangePreset, now: Date, timezone: string): Period {
  const days = PRESET_DAYS[preset];
  const today = zonedDay(now, timezone);
  // A janela termina no fim do dia de hoje: o dia corrente conta.
  const to = zonedDayStart(addDays(today, 1), timezone);
  const from = zonedDayStart(addDays(today, 1 - days), timezone);
  return { from, to, days, preset, value: preset, timezone };
}

/**
 * Lê o `?range=` da URL: `7d`/`30d`/`90d` ou `AAAA-MM-DD,AAAA-MM-DD`
 * (extremos inclusivos). Qualquer coisa inválida cai no padrão em silêncio —
 * uma URL torta não pode derrubar o dashboard.
 */
export function parseRange(
  raw: string | string[] | undefined,
  options: { now?: Date; timezone?: string } = {},
): Period {
  const now = options.now ?? new Date();
  const timezone = options.timezone ?? DEFAULT_TIMEZONE;
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (!value) return presetPeriod(DEFAULT_RANGE, now, timezone);
  if ((RANGE_PRESETS as readonly string[]).includes(value)) {
    return presetPeriod(value as RangePreset, now, timezone);
  }

  const [first, second] = value.split(',');
  if (!first || !second || !isValidDay(first) || !isValidDay(second) || first > second) {
    return presetPeriod(DEFAULT_RANGE, now, timezone);
  }

  const days = Math.round(
    (new Date(`${second}T00:00:00.000Z`).getTime() - new Date(`${first}T00:00:00.000Z`).getTime()) /
      DAY_MS +
      1,
  );
  if (days > MAX_RANGE_DAYS) return presetPeriod(DEFAULT_RANGE, now, timezone);

  return {
    from: zonedDayStart(first, timezone),
    to: zonedDayStart(addDays(second, 1), timezone),
    days,
    preset: null,
    value: `${first},${second}`,
    timezone,
  };
}

/** A janela imediatamente anterior, do mesmo tamanho — a base do delta. */
export function previousPeriod(period: Period): Period {
  const span = period.to.getTime() - period.from.getTime();
  return {
    ...period,
    from: new Date(period.from.getTime() - span),
    to: period.from,
    preset: null,
    value: period.value,
  };
}

/** Todos os dias do período, em ordem, como `YYYY-MM-DD`. */
export function listDays(period: Period): string[] {
  const first = zonedDay(period.from, period.timezone);
  return Array.from({ length: period.days }, (_, index) => addDays(first, index));
}

export interface DayCount {
  date: string;
  count: number;
}

/**
 * Buckets → série contínua: dia sem linha no banco vira `0`. Sem isso o
 * gráfico "pula" o dia silencioso e mente sobre a forma da curva.
 */
export function fillDays(points: readonly DayCount[], period: Period): DayCount[] {
  const byDay = new Map(points.map((point) => [point.date, point.count]));
  return listDays(period).map((date) => ({ date, count: byDay.get(date) ?? 0 }));
}

/**
 * Série por chave preenchida: cada dia do período ganha um valor para **toda**
 * chave pedida, na ordem em que `keys` chega (a ordem das cores do gráfico).
 */
export function fillDaysByKey(
  points: readonly { date: string; key: string; count: number }[],
  period: Period,
  keys: readonly string[],
): Record<string, number | string>[] {
  const byDay = new Map<string, Map<string, number>>();
  for (const point of points) {
    const row = byDay.get(point.date) ?? new Map<string, number>();
    row.set(point.key, (row.get(point.key) ?? 0) + point.count);
    byDay.set(point.date, row);
  }
  return listDays(period).map((date) => {
    const row = byDay.get(date);
    const entry: Record<string, number | string> = { date };
    for (const key of keys) entry[key] = row?.get(key) ?? 0;
    return entry;
  });
}

/**
 * Variação percentual contra o período anterior. `null` quando não há base de
 * comparação — `+∞%` num servidor novo não diz nada a ninguém.
 */
export function percentDelta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Chaves distintas de uma série, ordenadas pelo total (maior primeiro). */
export function rankKeys(points: readonly { key: string; count: number }[], limit = 5): string[] {
  const totals = new Map<string, number>();
  for (const point of points) totals.set(point.key, (totals.get(point.key) ?? 0) + point.count);
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => key);
}

/** `2026-09-06` → `06/09`, o rótulo curto dos eixos. */
export function formatDayLabel(day: string): string {
  const [, month, date] = day.split('-');
  return `${date}/${month}`;
}

/** Rótulo do período para o `screen-meta` do cabeçalho. */
export function formatPeriodLabel(period: Period): string {
  if (period.preset) return `ÚLTIMOS ${period.days} DIAS`;
  const days = listDays(period);
  const first = days[0];
  const last = days[days.length - 1];
  return `${formatDayLabel(first ?? '')} — ${formatDayLabel(last ?? '')}`;
}
