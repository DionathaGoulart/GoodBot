import {
  formationSize,
  summarizeFormations,
  summarizePairs,
  summarizePlayers,
  summarizeSession,
  type FormationSummary,
  type FormationTime,
  type PairTime,
  type PlayerStats,
  type SessionSummary,
  type SquadAttendanceRow,
  type SquadStatsSession,
} from '@goodbot/shared';

import type { MemberSummaryRow } from './squad-players';

/**
 * A aba JOGATINAS em funções puras, sem `server-only`: a página carrega as
 * linhas no servidor (`loadSquadSessions`, em `lib/squads.ts`) e a aba, que é
 * client component, recalcula tudo daqui quando o filtro muda.
 *
 * A conta não mora aqui: ela é a mesma regra pura de `shared/squads/stats.ts`
 * que o relatório do bot, o guia e o `/squad stats` usam. O que este arquivo
 * faz é escolher as jogatinas do filtro, virar ISO em `Date` e juntar nome de
 * pessoa e de squad ao resultado.
 */

/** Uma jogatina como o painel carrega do banco, com datas em ISO. */
export interface SessionRow {
  id: number;
  squadId: string;
  startsAt: string;
  endsAt: string;
  goingIds: string[];
  startedAt: string | null;
  playedAt: string | null;
  cancelledAt: string | null;
}

/** Uma entrada no voice de uma jogatina, com datas em ISO. */
export interface SessionAttendanceRow {
  sessionId: number;
  userId: string;
  joinedAt: string;
  /** `null` = ainda no voice. */
  leftAt: string | null;
  asGuest: boolean;
}

/** O squad de uma jogatina, inclusive arquivado: a jogatina dele continua contando. */
export interface SessionSquadRow {
  id: string;
  gameId: string;
  name: string;
}

/** Tudo que a aba JOGATINAS precisa, carregado uma vez por página. */
export interface SquadSessionsData {
  sessions: SessionRow[];
  attendance: SessionAttendanceRow[];
  squads: SessionSquadRow[];
  members: Record<string, MemberSummaryRow>;
  /** Bot fora do ar: os nomes caem para o ID e o resto continua funcionando. */
  membersError: string | null;
  /**
   * Quando o servidor leu. É o "agora" de toda conta: presença ainda aberta
   * conta até aqui, e um `Date.now()` no render daria um número no servidor e
   * outro no navegador.
   */
  loadedAt: number;
  /** A janela lida do banco, em dias. */
  windowDays: number;
}

/**
 * Como a jogatina terminou. `scheduled` e `running` são as que ainda vão
 * render número; `no_show` é a marcada que passou sem ninguém aparecer.
 */
export type SessionStatus = 'scheduled' | 'running' | 'played' | 'no_show' | 'cancelled';

/** Uma linha da tabela de jogatinas, com o relatório pronto para o sheet. */
export interface SessionTableRow extends Record<string, unknown> {
  id: number;
  squadId: string;
  squadName: string;
  gameId: string;
  startsAt: string;
  status: SessionStatus;
  /** Da primeira entrada à última saída; 0 sem presença medida. */
  durationMs: number;
  /** Quem disse VOU. */
  goingCount: number;
  /** Membros que apareceram (ou, sem sala, os que disseram VOU). */
  playedCount: number;
  guestCount: number;
  noShowCount: number;
  /** O resumo da regra pura; `null` na que ainda não aconteceu. */
  report: SessionSummary | null;
}

export interface SessionsFilter {
  /** `null` = todos os jogos. */
  gameId: string | null;
  /** `null` = todos os squads do jogo. */
  squadId: string | null;
  /** Janela em dias, contada de `loadedAt` para trás. */
  days: number;
  /**
   * Só as duplas e os grupos desta pessoa, cortados **depois** do filtro: com
   * o corte antes, o top do servidor inteiro engoliria as duplas dela.
   */
  focusUserId?: string | null;
}

export interface SessionsSummary {
  /** Jogatinas marcadas na janela, cancelada inclusive. */
  scheduled: number;
  played: number;
  cancelled: number;
  /** Tempo de sala: cada trecho conta uma vez, e não uma por pessoa nele. */
  roomMs: number;
  /** VOU cumpridos sobre VOU, de todo mundo; `null` sem nenhum VOU. */
  attendanceRate: number | null;
}

/** Uma pessoa no ranking, com o nome já resolvido. */
export interface PlayerRanking extends PlayerStats, Record<string, unknown> {
  name: string;
  avatarUrl: string | null;
  /** Convidado avulso que nunca foi membro de squad na janela. */
  guestOnly: boolean;
}

/** Uma dupla do ranking, com os dois nomes. */
export interface PairRanking extends PairTime {
  names: [string, string];
}

/** Um grupo exato do ranking, com os nomes. */
export interface GroupRanking {
  userIds: string[];
  names: string[];
  ms: number;
  /** O rótulo do tamanho ("quarteto") e como ele cabe na party. */
  size: FormationTime;
}

export interface SessionsView {
  rows: SessionTableRow[];
  summary: SessionsSummary;
  players: PlayerRanking[];
  formations: FormationSummary;
  pairs: PairRanking[];
  groups: GroupRanking[];
  /** Os ids do heatmap das duplas, do que mais jogou; matriz quadrada. */
  matrixIds: string[];
  /** `a:b` (ids em ordem) → tempo juntos, para a matriz. */
  pairMs: Map<string, number>;
}

/** Quantas duplas, grupos e pessoas cada lista mostra, como no `/squad stats`. */
export const SESSIONS_LISTED = 8;

const DAY_MS = 86_400_000;

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A chave de uma dupla na matriz, sempre na ordem dos ids. */
export function matrixKey(a: string, b: string): string {
  return [a, b].sort(byId).join(':');
}

/**
 * As jogatinas do filtro, já na janela pedida. A janela é só o limite de
 * baixo: o que ainda está marcado aparece como `scheduled`, porque a staff
 * abre a aba justamente para ver o que vem também.
 */
function filterSessions(
  data: SquadSessionsData,
  filter: SessionsFilter,
  squadById: Map<string, SessionSquadRow>,
): SessionRow[] {
  const from = data.loadedAt - filter.days * DAY_MS;
  return data.sessions.filter((session) => {
    if (Date.parse(session.startsAt) < from) return false;
    const squad = squadById.get(session.squadId);
    if (!squad) return false;
    if (filter.squadId) return squad.id === filter.squadId;
    if (filter.gameId) return squad.gameId === filter.gameId;
    return true;
  });
}

/** A presença em `Date`, como a regra pura espera. */
function toStatsRows(rows: readonly SessionAttendanceRow[]): SquadAttendanceRow[] {
  return rows.map((row) => ({
    sessionId: row.sessionId,
    userId: row.userId,
    joinedAt: new Date(row.joinedAt),
    leftAt: row.leftAt === null ? null : new Date(row.leftAt),
    asGuest: row.asGuest,
  }));
}

const toStatsSession = (session: SessionRow): SquadStatsSession => ({
  id: session.id,
  goingIds: session.goingIds,
  playedAt: session.playedAt === null ? null : new Date(session.playedAt),
});

function statusOf(session: SessionRow, now: number): SessionStatus {
  if (session.cancelledAt) return 'cancelled';
  if (session.playedAt) return Date.parse(session.endsAt) > now ? 'running' : 'played';
  return Date.parse(session.startsAt) > now ? 'scheduled' : 'no_show';
}

/**
 * Os números de um conjunto de jogatinas, do jeito que a tela mostra. A
 * `partySize` vem do jogo do filtro; sem jogo escolhido, nenhum grupo é "party
 * cheia", porque jogos diferentes têm party de tamanhos diferentes.
 */
export function buildSessionsView(
  data: SquadSessionsData,
  filter: SessionsFilter,
  partySize: number,
): SessionsView {
  const now = new Date(data.loadedAt);
  const squadById = new Map(data.squads.map((squad) => [squad.id, squad]));
  const sessions = filterSessions(data, filter, squadById);
  const ids = new Set(sessions.map((session) => session.id));
  const rows = toStatsRows(data.attendance.filter((row) => ids.has(row.sessionId)));
  const options = { now, partySize };
  const nameOf = (userId: string) => data.members[userId]?.displayName ?? userId;

  const tableRows: SessionTableRow[] = sessions.map((session) => {
    const squad = squadById.get(session.squadId);
    const status = statusOf(session, data.loadedAt);
    // A que ainda não aconteceu não tem relatório: "0 min, ninguém jogou" seria
    // um número errado, e não a ausência de número.
    const report =
      status === 'scheduled' || status === 'cancelled'
        ? null
        : summarizeSession(toStatsSession(session), rows, options);
    return {
      id: session.id,
      squadId: session.squadId,
      squadName: squad?.name ?? 'SQUAD REMOVIDO',
      gameId: squad?.gameId ?? '',
      startsAt: session.startsAt,
      status,
      durationMs: report?.durationMs ?? 0,
      goingCount: session.goingIds.length,
      playedCount: report?.players.filter((player) => player.status !== 'no_show').length ?? 0,
      guestCount: report?.guests.length ?? 0,
      noShowCount: report?.players.filter((player) => player.status === 'no_show').length ?? 0,
      report,
    };
  });

  const played = sessions.filter((session) => session.playedAt && !session.cancelledAt);
  const stats = summarizePlayers(played.map(toStatsSession), rows, options);
  const formations = summarizeFormations(rows, options);
  const kept = stats.reduce((total, player) => total + player.kept, 0);
  const going = stats.reduce((total, player) => total + player.going, 0);

  const guestIds = new Set(
    data.attendance.filter((row) => ids.has(row.sessionId) && row.asGuest).map((row) => row.userId),
  );
  const players: PlayerRanking[] = stats.map((player) => ({
    ...player,
    name: nameOf(player.userId),
    avatarUrl: data.members[player.userId]?.avatarUrl ?? null,
    guestOnly: player.going === 0 && guestIds.has(player.userId),
  }));

  const focus = filter.focusUserId ?? null;
  const inFocus = (userIds: readonly string[]) => focus === null || userIds.includes(focus);
  const allPairs = summarizePairs(rows, { now });
  const pairs = allPairs
    .filter((pair) => inFocus(pair.userIds))
    .slice(0, SESSIONS_LISTED)
    .map((pair) => ({
      ...pair,
      names: [nameOf(pair.userIds[0]), nameOf(pair.userIds[1])] as [string, string],
    }));
  const groups: GroupRanking[] = formations.groups
    .filter((group) => inFocus(group.userIds))
    .slice(0, SESSIONS_LISTED)
    .map((group) => ({
      ...group,
      names: group.userIds.map(nameOf),
      size: { ...formationSize(group.userIds.length, partySize), ms: group.ms },
    }));

  const pairMs = new Map(
    allPairs.map((pair) => [matrixKey(pair.userIds[0], pair.userIds[1]), pair.ms]),
  );

  return {
    rows: tableRows,
    summary: {
      scheduled: sessions.length,
      played: played.length,
      cancelled: sessions.filter((session) => session.cancelledAt !== null).length,
      roomMs: formations.bySize.reduce((total, size) => total + size.ms, 0),
      attendanceRate: going > 0 ? kept / going : null,
    },
    players,
    formations,
    pairs,
    groups,
    matrixIds: players.slice(0, SESSIONS_LISTED).map((player) => player.userId),
    pairMs,
  };
}

/**
 * Os números de uma pessoa num jogo, para o sheet da aba JOGADORES. Some as
 * jogatinas de todos os squads dela naquele jogo, como o `/squad stats`, e as
 * duplas e os grupos são filtrados por ela **antes** do corte, senão o ranking
 * do servidor inteiro engoliria os dela.
 */
export function buildPlayerSessionStats(
  data: SquadSessionsData,
  gameId: string,
  userId: string,
  partySize: number,
): { stats: PlayerStats | null; pairs: PairRanking[]; sessions: number } {
  const view = buildSessionsView(
    data,
    { gameId, squadId: null, days: data.windowDays, focusUserId: userId },
    partySize,
  );
  return {
    stats: view.players.find((player) => player.userId === userId) ?? null,
    pairs: view.pairs,
    sessions: view.summary.played,
  };
}
