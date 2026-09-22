import { DAY_MS, SQUAD_BLOCKS } from '../constants';
import { formatPlaytime, mergeIntervals } from './stats';
import { WEEKDAY_NAMES } from './when';
import { toLocalDateTime } from './zoned';

import type { SquadSlot } from './availability';
import type { TimeInterval } from './stats';
import type { SquadBlockConfig } from '../config/squads';

/**
 * O histórico de jogatinas de um squad: quantas rolaram, quando costumam
 * jogar e quem mais aparece. Puro, como o resto da regra: o bot lê as linhas
 * do banco e o painel formata o resumo que a API devolve, os dois com as
 * mesmas funções.
 *
 * Só conta jogatina que **rolou** (`played_at`): marcar e ninguém aparecer não
 * é histórico, e é justamente o que o candidato a entrar quer saber.
 */

/** Quantos dias de jogatinas o detalhe (células e frequentes) olha. */
export const SQUAD_HISTORY_WINDOW_DAYS = 90;
/** O "último mês" do resumo. */
export const SQUAD_HISTORY_RECENT_DAYS = 30;
/** Quantas células de costume o resumo guarda. */
export const SQUAD_HISTORY_CELLS = 3;
/** Quantos frequentes o resumo guarda. */
export const SQUAD_HISTORY_REGULARS = 5;
/** Uma célula vira "geralmente" a partir de quantas jogatinas nela: uma vez só não é costume. */
export const SQUAD_HISTORY_HABIT = 2;

/** Uma jogatina que rolou, dentro da janela. */
export interface SquadHistorySession {
  id: number;
  startsAt: Date;
  /** Quem disse "vou": vale como presença quando a jogatina não teve sala. */
  goingIds: readonly string[];
}

/**
 * Alguém do squad no voice reservado de uma jogatina. O intervalo é opcional
 * porque quem só conta presença (quem esteve) não precisa dele; sem ele, as
 * horas do resumo ficam em zero.
 */
export interface SquadHistoryAttendance {
  sessionId: number;
  userId: string;
  joinedAt?: Date;
  /** `null` = ainda no voice: conta até `now`. */
  leftAt?: Date | null;
}

/** Contagem de todas as jogatinas que rolaram, sem janela. */
export interface SquadHistoryTotals {
  played: number;
  lastPlayedAt: Date | null;
}

export interface SquadRegular {
  userId: string;
  /** Em quantas jogatinas da janela a pessoa esteve. */
  count: number;
  /** Tempo dela no voice das jogatinas da janela, em ms; 0 sem presença medida. */
  ms: number;
}

export interface SquadHistory {
  playedLast30d: number;
  /**
   * Quanto o squad jogou no último mês, em ms: por jogatina, da primeira
   * entrada à última saída, somado. É tempo de jogatina, não a soma do tempo
   * de cada um. 0 quando nenhuma delas teve presença medida.
   */
  msLast30d: number;
  /**
   * VOU cumpridos sobre VOU dados, nas jogatinas da janela; `null` quando
   * ninguém disse VOU. Jogatina sem presença medida não conta falta para
   * ninguém: ela entra como cumprida, do mesmo jeito que já conta no histórico.
   */
  attendanceRate: number | null;
  playedTotal: number;
  /** O início da última jogatina que rolou; `null` = nunca jogaram. */
  lastPlayedAt: Date | null;
  /** As células (dia e faixa no fuso da guild) com mais jogatinas, da mais cheia. */
  usualCells: SquadSlot[];
  /** Quem mais esteve nas jogatinas, do mais presente. */
  regulars: SquadRegular[];
}

export interface SummarizeHistoryInput {
  /** Jogatinas que rolaram dentro da janela, de qualquer ordem. */
  sessions: readonly SquadHistorySession[];
  attendance: readonly SquadHistoryAttendance[];
  /** Sem totais, contam só as jogatinas da janela. */
  totals?: SquadHistoryTotals | null;
  now: Date;
  timeZone: string;
  blocks: readonly SquadBlockConfig[];
}

export const EMPTY_SQUAD_HISTORY: SquadHistory = {
  playedLast30d: 0,
  msLast30d: 0,
  attendanceRate: null,
  playedTotal: 0,
  lastPlayedAt: null,
  usualCells: [],
  regulars: [],
};

/** A faixa que contém a hora; `null` quando a grade configurada deixa um buraco. */
function blockAt(hour: number, blocks: readonly SquadBlockConfig[]): number | null {
  const index = blocks.findIndex((block) => block.startHour <= hour && hour < block.endHour);
  return index === -1 ? null : index;
}

const byUserId = (a: SquadRegular, b: SquadRegular) =>
  a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;

/** As linhas de presença viram intervalos; sem `joined_at` não há tempo a contar. */
function intervalsOf(rows: readonly SquadHistoryAttendance[], now: Date): TimeInterval[] {
  return rows.flatMap((row) =>
    row.joinedAt ? [{ start: row.joinedAt.getTime(), end: (row.leftAt ?? now).getTime() }] : [],
  );
}

const lengthOf = (intervals: readonly TimeInterval[]) =>
  intervals.reduce((total, interval) => total + interval.end - interval.start, 0);

/** Da primeira entrada à última saída de uma jogatina; 0 sem presença medida. */
function sessionSpanMs(rows: readonly SquadHistoryAttendance[], now: Date): number {
  const intervals = intervalsOf(rows, now);
  if (intervals.length === 0) return 0;
  const start = Math.min(...intervals.map((interval) => interval.start));
  const end = Math.max(...intervals.map((interval) => interval.end));
  return Math.max(0, end - start);
}

/** O tempo de cada pessoa numa jogatina, com entradas repetidas contadas uma vez. */
function timeByUser(
  rows: readonly SquadHistoryAttendance[],
  now: Date,
): Map<string, TimeInterval[]> {
  const raw = new Map<string, TimeInterval[]>();
  for (const row of rows) {
    if (!row.joinedAt) continue;
    const interval = { start: row.joinedAt.getTime(), end: (row.leftAt ?? now).getTime() };
    raw.set(row.userId, [...(raw.get(row.userId) ?? []), interval]);
  }
  return new Map([...raw.entries()].map(([userId, list]) => [userId, mergeIntervals(list)]));
}

/**
 * O resumo do histórico. A célula de uma jogatina é o dia e a faixa do início
 * no fuso da guild. Quem esteve é quem apareceu no voice reservado; jogatina
 * sem ninguém registrado no voice (sem sala, ou o bot fora do ar na hora)
 * conta quem disse "vou". Empates saem sempre na mesma ordem: célula pelo bit,
 * pessoa pelo id.
 */
export function summarizeHistory(input: SummarizeHistoryInput): SquadHistory {
  const now = input.now.getTime();
  const recentFrom = now - SQUAD_HISTORY_RECENT_DAYS * DAY_MS;

  const present = new Map<number, Set<string>>();
  const rowsOf = new Map<number, SquadHistoryAttendance[]>();
  for (const row of input.attendance) {
    const users = present.get(row.sessionId) ?? new Set<string>();
    users.add(row.userId);
    present.set(row.sessionId, users);
    rowsOf.set(row.sessionId, [...(rowsOf.get(row.sessionId) ?? []), row]);
  }

  let playedLast30d = 0;
  let msLast30d = 0;
  let going = 0;
  let kept = 0;
  let lastPlayed: number | null = null;
  const cells = new Map<number, SquadSlot>();
  const regulars = new Map<string, number>();
  const regularMs = new Map<string, number>();
  for (const session of input.sessions) {
    const startsAt = session.startsAt.getTime();
    const rows = rowsOf.get(session.id) ?? [];
    if (startsAt >= recentFrom) {
      playedLast30d++;
      msLast30d += sessionSpanMs(rows, input.now);
    }
    if (lastPlayed === null || startsAt > lastPlayed) lastPlayed = startsAt;

    const local = toLocalDateTime(session.startsAt, input.timeZone);
    const block = blockAt(local.hour, input.blocks);
    if (block !== null) {
      const bit = local.weekday * SQUAD_BLOCKS.length + block;
      const cell = cells.get(bit) ?? { day: local.weekday, block, count: 0 };
      cell.count++;
      cells.set(bit, cell);
    }

    const measured = present.get(session.id);
    const who = measured ?? new Set(session.goingIds);
    for (const userId of who) regulars.set(userId, (regulars.get(userId) ?? 0) + 1);
    for (const [userId, intervals] of timeByUser(rows, input.now)) {
      regularMs.set(userId, (regularMs.get(userId) ?? 0) + lengthOf(intervals));
    }

    going += session.goingIds.length;
    // Sem presença medida (jogatina sem sala, ou o bot fora do ar), o VOU vale
    // como presença: é a mesma regra que põe essa gente entre os frequentes.
    kept += measured
      ? session.goingIds.filter((userId) => measured.has(userId)).length
      : session.goingIds.length;
  }

  const totals = input.totals;
  const totalLast = totals?.lastPlayedAt?.getTime() ?? null;
  if (totalLast !== null && (lastPlayed === null || totalLast > lastPlayed)) lastPlayed = totalLast;

  return {
    playedLast30d,
    msLast30d,
    attendanceRate: going > 0 ? kept / going : null,
    playedTotal: Math.max(totals?.played ?? 0, input.sessions.length),
    lastPlayedAt: lastPlayed === null ? null : new Date(lastPlayed),
    usualCells: [...cells.entries()]
      .sort(([bitA, a], [bitB, b]) => b.count - a.count || bitA - bitB)
      .slice(0, SQUAD_HISTORY_CELLS)
      .map(([, cell]) => cell),
    regulars: [...regulars.entries()]
      .map(([userId, count]) => ({ userId, count, ms: regularMs.get(userId) ?? 0 }))
      .sort((a, b) => b.count - a.count || b.ms - a.ms || byUserId(a, b))
      .slice(0, SQUAD_HISTORY_REGULARS),
  };
}

export interface FormatHistoryOptions {
  now: Date;
  timeZone: string;
  blocks: readonly SquadBlockConfig[];
}

/** "à noite", "de madrugada": a preposição sai da chave, o nome do rótulo configurado. */
function blockPhrase(block: SquadBlockConfig): string {
  const label = block.label.toLowerCase();
  return block.key === 'afternoon' || block.key === 'evening' ? `à ${label}` : `de ${label}`;
}

/** "a", "a e b", "a, b e c". */
function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1] ?? ''}`;
}

/**
 * "sexta e sábado à noite", "sexta à noite e domingo à tarde". Os dias da
 * mesma faixa vão juntos, na ordem das células.
 */
function usualText(cells: readonly SquadSlot[], blocks: readonly SquadBlockConfig[]): string {
  const groups = new Map<number, string[]>();
  for (const cell of cells) {
    if (!blocks[cell.block]) continue;
    const days = groups.get(cell.block) ?? [];
    days.push(WEEKDAY_NAMES[cell.day] ?? '');
    groups.set(cell.block, days);
  }
  return joinList(
    [...groups.entries()].map(([block, days]) => {
      const config = blocks[block];
      return config ? `${joinList(days)} ${blockPhrase(config)}` : joinList(days);
    }),
  );
}

/** "hoje", "ontem", "há 3 dias", "há 2 semanas", "há 4 meses", em dias do calendário da guild. */
function agoText(at: Date, now: Date, timeZone: string): string {
  const then = toLocalDateTime(at, timeZone);
  const today = toLocalDateTime(now, timeZone);
  const days = Math.round(
    (Date.UTC(today.year, today.month - 1, today.day) -
      Date.UTC(then.year, then.month - 1, then.day)) /
      DAY_MS,
  );
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 14) return `há ${String(days)} dias`;
  if (days < 60) return `há ${String(Math.floor(days / 7))} semanas`;
  return `há ${String(Math.floor(days / 30))} meses`;
}

/** "80% de presença": VOU cumpridos, arredondado. */
function attendanceText(rate: number): string {
  return `${String(Math.round(rate * 100))}% de presença`;
}

/**
 * O histórico numa frase curta em pt-BR, sem menção nem timestamp do Discord:
 * serve ao embed e ao painel. "6 jogatinas e 11 h no último mês, 80% de
 * presença, geralmente sexta e sábado à noite. Última há 3 dias." ou "Ainda não
 * jogaram.".
 *
 * As horas só entram quando houve presença medida, e a presença só quando
 * alguém disse VOU: um número em zero por falta de dado diria "não jogam", que
 * é outra coisa.
 */
export function formatHistory(history: SquadHistory, options: FormatHistoryOptions): string {
  if (history.playedTotal === 0 || history.lastPlayedAt === null) return 'Ainda não jogaram.';

  const recent = history.playedLast30d;
  const played = `${String(recent)} ${recent === 1 ? 'jogatina' : 'jogatinas'}`;
  let text =
    recent === 0
      ? `Nenhuma jogatina no último mês (${String(history.playedTotal)} no total)`
      : history.msLast30d > 0
        ? `${played} e ${formatPlaytime(history.msLast30d)} no último mês`
        : `${played} no último mês`;
  if (history.attendanceRate !== null) text += `, ${attendanceText(history.attendanceRate)}`;
  const habits = history.usualCells.filter((cell) => cell.count >= SQUAD_HISTORY_HABIT);
  const usual = usualText(habits, options.blocks);
  if (usual) text += `, geralmente ${usual}`;
  return `${text}. Última ${agoText(history.lastPlayedAt, options.now, options.timeZone)}.`;
}
