/**
 * Os números das jogatinas: quanto cada pessoa jogou, com quem, em que
 * formação e se foi quando disse que ia. Puro, como o resto da regra: o bot
 * (relatório, guia, `/squad stats`) e o painel leem as linhas do banco e
 * chamam as mesmas funções.
 *
 * A fonte é uma só: a presença no voice reservado (`squad_session_attendance`),
 * uma linha por entrada. Tudo sai de uma varredura de linha do tempo por
 * jogatina: entre duas entradas ou saídas, o conjunto de quem está no voice
 * não muda, e cada trecho vira uma **formação** (quem estava, por quanto
 * tempo). Tamanho do grupo, grupo exato e duplas são somas desses trechos.
 *
 * Tempo em milissegundos; quem mostra arredonda. Linha ainda aberta conta até
 * `now`.
 */

import { MINUTE_MS } from '../constants';

/**
 * Tempo de jogatina em pt-BR: "40 min", "2 h", "1 h 40". Hora e minuto bastam,
 * porque a jogatina dura no máximo 12 h, e o segundo só faria ruído. Abaixo de
 * um minuto não vira "0 min": quem entrou e saiu esteve lá.
 */
export function formatPlaytime(ms: number): string {
  if (!Number.isFinite(ms) || ms < MINUTE_MS) return 'menos de 1 min';
  const minutes = Math.floor(ms / MINUTE_MS);
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)}`;
}

/** Uma entrada de alguém no voice de uma jogatina. */
export interface SquadAttendanceRow {
  sessionId: number;
  userId: string;
  joinedAt: Date;
  /** `null` = ainda no voice: conta até `now`. */
  leftAt: Date | null;
  /** Convidado avulso: conta no tempo e nas formações, nunca em VOU nem em falta. */
  asGuest?: boolean;
}

/** Uma jogatina, só com o que os números usam. */
export interface SquadStatsSession {
  id: number;
  /** Quem disse "vou". Sem presença medida, vale como presença (como no histórico). */
  goingIds: readonly string[];
  /** A jogatina rolou (`played_at`). */
  playedAt: Date | null;
}

export interface TimeInterval {
  /** Epoch em ms, inclusivo. */
  start: number;
  /** Epoch em ms, exclusivo. */
  end: number;
}

/**
 * Junta intervalos que se sobrepõem ou se encostam, em ordem. Intervalo
 * vazio ou invertido some. Sair e voltar no mesmo instante vira um intervalo
 * só.
 */
export function mergeIntervals(intervals: readonly TimeInterval[]): TimeInterval[] {
  const sorted = intervals
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: TimeInterval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

const lengthOf = (intervals: readonly TimeInterval[]) =>
  intervals.reduce((total, interval) => total + interval.end - interval.start, 0);

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** As linhas agrupadas por jogatina, na ordem do id. */
function bySession(rows: readonly SquadAttendanceRow[]): Map<number, SquadAttendanceRow[]> {
  const sessions = new Map<number, SquadAttendanceRow[]>();
  for (const row of rows) {
    sessions.set(row.sessionId, [...(sessions.get(row.sessionId) ?? []), row]);
  }
  return new Map([...sessions.entries()].sort(([a], [b]) => a - b));
}

/** Os intervalos de cada pessoa numa jogatina, já juntados. */
function intervalsByUser(
  rows: readonly SquadAttendanceRow[],
  now: Date,
): Map<string, TimeInterval[]> {
  const raw = new Map<string, TimeInterval[]>();
  for (const row of rows) {
    const interval = {
      start: row.joinedAt.getTime(),
      end: (row.leftAt ?? now).getTime(),
    };
    raw.set(row.userId, [...(raw.get(row.userId) ?? []), interval]);
  }
  return new Map([...raw.entries()].map(([userId, list]) => [userId, mergeIntervals(list)]));
}

/**
 * Tempo de presença: por pessoa e jogatina, a união dos intervalos (entradas
 * repetidas ou sobrepostas não contam duas vezes), somada. Com as linhas de
 * uma pessoa só, é o tempo dela.
 */
export function presenceMs(rows: readonly SquadAttendanceRow[], now: Date): number {
  let total = 0;
  for (const sessionRows of bySession(rows).values()) {
    for (const intervals of intervalsByUser(sessionRows, now).values()) {
      total += lengthOf(intervals);
    }
  }
  return total;
}

/** Um trecho da jogatina em que o voice não mudou. */
export interface FormationSegment {
  /** Quem estava, em ordem de id. */
  userIds: string[];
  start: Date;
  end: Date;
  ms: number;
}

/**
 * A linha do tempo de **uma** jogatina em formações: entre duas entradas ou
 * saídas, quem está no voice não muda, e cada trecho vira um segmento. Trecho
 * com o voice vazio fica de fora; trechos seguidos com as mesmas pessoas viram
 * um só.
 */
export function formationSegments(
  rows: readonly SquadAttendanceRow[],
  now: Date,
): FormationSegment[] {
  const users = [...intervalsByUser(rows, now).entries()].sort(([a], [b]) => byId(a, b));
  const cuts = [
    ...new Set(users.flatMap(([, intervals]) => intervals.flatMap((i) => [i.start, i.end]))),
  ].sort((a, b) => a - b);

  const segments: FormationSegment[] = [];
  for (let index = 0; index + 1 < cuts.length; index++) {
    const start = cuts[index] as number;
    const end = cuts[index + 1] as number;
    const userIds = users
      .filter(([, intervals]) => intervals.some((i) => i.start <= start && end <= i.end))
      .map(([userId]) => userId);
    if (userIds.length === 0) continue;

    const last = segments[segments.length - 1];
    if (last && last.end.getTime() === start && last.userIds.join() === userIds.join()) {
      last.end = new Date(end);
      last.ms += end - start;
    } else {
      segments.push({ userIds, start: new Date(start), end: new Date(end), ms: end - start });
    }
  }
  return segments;
}

/** Cabe numa party, enche uma, ou passa (e o grupo tem de se dividir). */
export type FormationParty = 'partial' | 'full' | 'over';

export interface FormationSize {
  size: number;
  /** "solo", "dupla", "trio", "quarteto" ou "grupo de N". */
  label: string;
  party: FormationParty;
}

const SIZE_LABELS = ['solo', 'dupla', 'trio', 'quarteto'];

/** O rótulo de um grupo de `size` pessoas, e como ele cabe na party do jogo. */
export function formationSize(size: number, partySize: number): FormationSize {
  return {
    size,
    label: SIZE_LABELS[size - 1] ?? `grupo de ${String(size)}`,
    party: size < partySize ? 'partial' : size === partySize ? 'full' : 'over',
  };
}

export interface FormationTime extends FormationSize {
  ms: number;
}

/** Um grupo exato (duas pessoas ou mais) e quanto tempo ele passou junto, só ele. */
export interface GroupTime {
  userIds: string[];
  ms: number;
}

export interface FormationSummary {
  /** Tempo por tamanho de grupo, do menor para o maior. */
  bySize: FormationTime[];
  /** Os grupos exatos, de quem mais jogou junto; solo não é grupo. */
  groups: GroupTime[];
}

export interface StatsOptions {
  now: Date;
  /** A party do jogo: separa "cheio" de "mais que uma party". */
  partySize: number;
}

export interface LimitOptions {
  /** Quantos devolver; sem limite, todos. */
  limit?: number;
}

/** Tempo por tamanho de grupo a partir dos segmentos. */
function sizeTimes(segments: readonly FormationSegment[], partySize: number): FormationTime[] {
  const bySize = new Map<number, number>();
  for (const segment of segments) {
    const size = segment.userIds.length;
    bySize.set(size, (bySize.get(size) ?? 0) + segment.ms);
  }
  return [...bySize.entries()]
    .sort(([a], [b]) => a - b)
    .map(([size, ms]) => ({ ...formationSize(size, partySize), ms }));
}

/** Os segmentos de todas as jogatinas das linhas. */
function allSegments(rows: readonly SquadAttendanceRow[], now: Date): FormationSegment[] {
  return [...bySession(rows).values()].flatMap((sessionRows) =>
    formationSegments(sessionRows, now),
  );
}

/**
 * As formações de um conjunto de jogatinas: quanto se jogou solo, em dupla,
 * em trio, com a party cheia ou com mais que uma party, e os grupos exatos
 * que mais jogam juntos. "A, B, C e D" só conta o tempo em que eram
 * exatamente esses quatro no voice.
 */
export function summarizeFormations(
  rows: readonly SquadAttendanceRow[],
  options: StatsOptions & LimitOptions,
): FormationSummary {
  const segments = allSegments(rows, options.now);
  const groups = new Map<string, GroupTime>();
  for (const segment of segments) {
    if (segment.userIds.length < 2) continue;
    const key = segment.userIds.join();
    const group = groups.get(key) ?? { userIds: segment.userIds, ms: 0 };
    group.ms += segment.ms;
    groups.set(key, group);
  }
  return {
    bySize: sizeTimes(segments, options.partySize),
    groups: [...groups.entries()]
      .sort(([keyA, a], [keyB, b]) => b.ms - a.ms || byId(keyA, keyB))
      .slice(0, options.limit)
      .map(([, group]) => group),
  };
}

/** Tempo em que as duas pessoas estiveram no mesmo voice, com ou sem mais gente. */
export function pairOverlapMs(
  rows: readonly SquadAttendanceRow[],
  a: string,
  b: string,
  now: Date,
): number {
  if (a === b) return 0;
  return allSegments(rows, now)
    .filter((segment) => segment.userIds.includes(a) && segment.userIds.includes(b))
    .reduce((total, segment) => total + segment.ms, 0);
}

export interface PairTime {
  /** As duas pessoas, em ordem de id. */
  userIds: [string, string];
  ms: number;
}

/** Quem mais joga com quem: o tempo juntos de cada dupla, com ou sem mais gente no voice. */
export function summarizePairs(
  rows: readonly SquadAttendanceRow[],
  options: { now: Date } & LimitOptions,
): PairTime[] {
  const pairs = new Map<string, PairTime>();
  for (const segment of allSegments(rows, options.now)) {
    const ids = segment.userIds;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const userIds: [string, string] = [ids[i] as string, ids[j] as string];
        const key = userIds.join();
        const pair = pairs.get(key) ?? { userIds, ms: 0 };
        pair.ms += segment.ms;
        pairs.set(key, pair);
      }
    }
  }
  return [...pairs.entries()]
    .sort(([keyA, a], [keyB, b]) => b.ms - a.ms || byId(keyA, keyB))
    .slice(0, options.limit)
    .map(([, pair]) => pair);
}

/**
 * Como a jogatina foi medida. `measured`: alguém do squad esteve no voice.
 * `unmeasured`: rolou (`played_at`) sem presença gravada, porque não teve sala
 * ou o bot estava fora do ar; vale o VOU. `not_played`: ninguém do squad
 * apareceu.
 */
export type SessionOutcome = 'measured' | 'unmeasured' | 'not_played';

/**
 * `attended`: disse VOU e foi. `walk_in`: foi sem ter dito VOU. `no_show`:
 * disse VOU e não apareceu.
 */
export type PresenceStatus = 'attended' | 'walk_in' | 'no_show';

export interface SessionPlayer {
  userId: string;
  ms: number;
  status: PresenceStatus;
}

export interface SessionGuest {
  userId: string;
  ms: number;
}

export interface SessionSummary {
  sessionId: number;
  outcome: SessionOutcome;
  /** Primeira entrada no voice; `null` sem presença. */
  firstJoinAt: Date | null;
  /** Última saída (ou `now`, com alguém ainda no voice); `null` sem presença. */
  lastLeaveAt: Date | null;
  /** Da primeira entrada à última saída; 0 sem presença. */
  durationMs: number;
  /** Alguém ainda no voice: fim e tempos são provisórios. */
  open: boolean;
  /** Membros, do que mais jogou. */
  players: SessionPlayer[];
  /** Convidados avulsos, à parte, do que mais jogou. */
  guests: SessionGuest[];
  formations: FormationSummary;
}

const byMsThenId = (a: { ms: number; userId: string }, b: { ms: number; userId: string }) =>
  b.ms - a.ms || byId(a.userId, b.userId);

/** O resumo de uma jogatina: quanto durou, quem foi, quem faltou e em que formações. */
export function summarizeSession(
  session: SquadStatsSession,
  rows: readonly SquadAttendanceRow[],
  options: StatsOptions,
): SessionSummary {
  const own = rows.filter((row) => row.sessionId === session.id);
  const memberRows = own.filter((row) => !row.asGuest);
  const guestRows = own.filter((row) => row.asGuest);
  const outcome: SessionOutcome =
    memberRows.length > 0 ? 'measured' : session.playedAt ? 'unmeasured' : 'not_played';

  const memberTime = intervalsByUser(memberRows, options.now);
  const going = new Set(session.goingIds);
  const players: SessionPlayer[] = [];
  for (const [userId, intervals] of memberTime) {
    players.push({
      userId,
      ms: lengthOf(intervals),
      status: going.has(userId) ? 'attended' : 'walk_in',
    });
  }
  for (const userId of going) {
    if (memberTime.has(userId)) continue;
    players.push({ userId, ms: 0, status: outcome === 'unmeasured' ? 'attended' : 'no_show' });
  }

  const guests = [...intervalsByUser(guestRows, options.now).entries()].map(
    ([userId, intervals]) => ({ userId, ms: lengthOf(intervals) }),
  );

  const starts = own.map((row) => row.joinedAt.getTime());
  const ends = own.map((row) => (row.leftAt ?? options.now).getTime());
  const first = starts.length > 0 ? Math.min(...starts) : null;
  const last = ends.length > 0 ? Math.max(...ends) : null;

  return {
    sessionId: session.id,
    outcome,
    firstJoinAt: first === null ? null : new Date(first),
    lastLeaveAt: last === null ? null : new Date(last),
    durationMs: first === null || last === null ? 0 : Math.max(0, last - first),
    open: own.some((row) => row.leftAt === null),
    players: players.sort(byMsThenId),
    guests: guests.sort(byMsThenId),
    formations: summarizeFormations(own, options),
  };
}

export interface PlayerStats {
  userId: string;
  /** Tempo no voice das jogatinas, somado. */
  ms: number;
  /** O tempo dela por tamanho do grupo em que estava. */
  bySize: FormationTime[];
  /** Jogatinas em que esteve: no voice, ou com VOU nas que rolaram sem presença medida. */
  sessions: number;
  /** Jogatinas em que disse VOU. */
  going: number;
  /** VOU cumpridos. */
  kept: number;
  /** VOU sem aparecer. */
  noShows: number;
  /** Apareceu sem ter dito VOU. */
  walkIns: number;
  /** VOU cumpridos sobre VOU; `null` sem nenhum VOU. */
  attendanceRate: number | null;
}

/**
 * Os números por pessoa num conjunto de jogatinas. Jogatina que não rolou
 * (`not_played`) fica de fora, como no histórico: marcar e ninguém aparecer
 * não é jogatina, e contaria falta para todo mundo que disse VOU. Convidado
 * soma tempo e jogatinas, nunca VOU nem falta.
 */
export function summarizePlayers(
  sessions: readonly SquadStatsSession[],
  rows: readonly SquadAttendanceRow[],
  options: StatsOptions,
): PlayerStats[] {
  const rowsBySession = bySession(rows);
  const players = new Map<string, PlayerStats & { sizes: Map<number, number> }>();
  const player = (userId: string) => {
    let stats = players.get(userId);
    if (!stats) {
      stats = {
        userId,
        ms: 0,
        bySize: [],
        sessions: 0,
        going: 0,
        kept: 0,
        noShows: 0,
        walkIns: 0,
        attendanceRate: null,
        sizes: new Map(),
      };
      players.set(userId, stats);
    }
    return stats;
  };

  for (const session of sessions) {
    const sessionRows = rowsBySession.get(session.id) ?? [];
    const summary = summarizeSession(session, sessionRows, options);
    if (summary.outcome === 'not_played') continue;

    for (const entry of summary.players) {
      const stats = player(entry.userId);
      stats.ms += entry.ms;
      if (entry.status !== 'no_show') stats.sessions++;
      if (entry.status !== 'walk_in') stats.going++;
      if (entry.status === 'attended') stats.kept++;
      if (entry.status === 'no_show') stats.noShows++;
      if (entry.status === 'walk_in') stats.walkIns++;
    }
    for (const guest of summary.guests) {
      const stats = player(guest.userId);
      stats.ms += guest.ms;
      stats.sessions++;
    }
    for (const segment of formationSegments(sessionRows, options.now)) {
      for (const userId of segment.userIds) {
        const sizes = player(userId).sizes;
        const size = segment.userIds.length;
        sizes.set(size, (sizes.get(size) ?? 0) + segment.ms);
      }
    }
  }

  return [...players.values()]
    .map(({ sizes, ...stats }) => ({
      ...stats,
      bySize: [...sizes.entries()]
        .sort(([a], [b]) => a - b)
        .map(([size, ms]) => ({ ...formationSize(size, options.partySize), ms })),
      attendanceRate: stats.going > 0 ? stats.kept / stats.going : null,
    }))
    .sort((a, b) => b.ms - a.ms || b.sessions - a.sessions || byId(a.userId, b.userId));
}
