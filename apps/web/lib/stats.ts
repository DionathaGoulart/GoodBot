import 'server-only';

import {
  automodByRule,
  countTicketsByStatus,
  dailySeries,
  getAutomodRules,
  getGuildSettings,
  heatmapHourWeekday,
  latestMembersTotal,
  listRecentAudit,
  listRecentCases,
  membersGrowth,
  messagesPerDay,
  seriesByDayAndKey,
  summary,
  topChannels,
} from '@goodbot/db';
import { unstable_cache } from 'next/cache';

import { db } from './db';
import { internalApi } from './internal-api';
import {
  DEFAULT_TIMEZONE,
  fillDays,
  fillDaysByKey,
  listDays,
  percentDelta,
  previousPeriod,
  rankKeys,
  type DayCount,
  type Period,
} from './stats-period';

import type { AuditSource } from '@goodbot/shared';

/**
 * Leituras do dashboard (PRD §6.1). Quase tudo passa por `unstable_cache` de
 * 60s por guild + período: seis blocos batendo no Supabase a cada F5 não valem
 * o frescor de meio minuto. A exceção é `loadRecentAudit` — ver lá por quê. (`use cache` exigiria ligar `cacheComponents`, o que
 * é assunto da Etapa 20.)
 *
 * O que sai daqui é sempre serializável — nada de `Date`, que o cache do Next
 * devolveria como string e quebraria o componente.
 */
const TTL_SECONDS = 60;

function cacheKey(name: string, guildId: string, period: Period): string[] {
  return ['stats', name, guildId, period.value, period.from.toISOString(), period.timezone];
}

function cached<T>(
  name: string,
  guildId: string,
  period: Period,
  load: () => Promise<T>,
): Promise<T> {
  return unstable_cache(load, cacheKey(name, guildId, period), {
    revalidate: TTL_SECONDS,
    tags: [`stats:${guildId}`],
  })();
}

/** Fuso da guild — decide onde o dia começa em todo gráfico. */
export async function guildTimezone(guildId: string): Promise<string> {
  const settings = await unstable_cache(
    async () => (await getGuildSettings(db(), guildId))?.timezone ?? null,
    ['stats', 'timezone', guildId],
    { revalidate: 300, tags: [`stats:${guildId}`] },
  )();
  return settings ?? DEFAULT_TIMEZONE;
}

function repoPeriod(guildId: string, period: Period) {
  return { guildId, from: period.from, to: period.to, timezone: period.timezone };
}

// ── stat tiles ──────────────────────────────────────────────────────────────

export interface Tile {
  value: number;
  /** Variação percentual contra o período anterior; `null` sem base. */
  delta: number | null;
  /** Série do período para a sparkline. */
  spark: number[];
}

export interface DashboardTiles {
  /** Saldo do período (entradas − saídas) e o total do último snapshot. */
  members: Tile & { total: number | null };
  messages: Tile;
  cases: Tile;
  automod: Tile;
  openTickets: number;
}

export async function loadTiles(guildId: string, period: Period): Promise<DashboardTiles> {
  return cached('tiles', guildId, period, async () => {
    const executor = db();
    const scope = repoPeriod(guildId, period);
    const [totals, messages, growth, cases, automod, openTickets, membersTotal] = await Promise.all(
      [
        summary(executor, scope),
        messagesPerDay(executor, scope),
        membersGrowth(executor, scope),
        dailySeries(executor, scope, 'cases_type'),
        dailySeries(executor, scope, 'automod_rule'),
        countTicketsByStatus(executor, guildId, 'open'),
        latestMembersTotal(executor, scope),
      ],
    );

    const tile = (
      totalsOfKind: { current: number; previous: number },
      points: readonly DayCount[],
    ): Tile => ({
      value: totalsOfKind.current,
      delta: percentDelta(totalsOfKind.current, totalsOfKind.previous),
      spark: fillDays(points, period).map((point) => point.count),
    });

    // Membros: o número grande é o total do último snapshot, mas a variação só
    // faz sentido sobre o saldo do período (entradas − saídas).
    const net = totals.joins.current - totals.leaves.current;
    const netBefore = totals.joins.previous - totals.leaves.previous;

    return {
      members: {
        value: net,
        total: membersTotal,
        delta: percentDelta(net, netBefore),
        spark: growth.map((point) => point.joins - point.leaves),
      },
      messages: tile(totals.messages, messages),
      cases: tile(totals.cases, cases),
      automod: tile(totals.automodHits, automod),
      openTickets,
    };
  });
}

// ── gráficos ────────────────────────────────────────────────────────────────

export interface ComparedPoint {
  date: string;
  current: number;
  previous: number;
}

/** Mensagens por dia com o período anterior sobreposto (PRD §6.1). */
export async function loadMessages(guildId: string, period: Period): Promise<ComparedPoint[]> {
  return cached('messages', guildId, period, async () => {
    const before = previousPeriod(period);
    const [now, then] = await Promise.all([
      messagesPerDay(db(), repoPeriod(guildId, period)),
      messagesPerDay(db(), repoPeriod(guildId, before)),
    ]);
    const currentSeries = fillDays(now, period);
    const previousSeries = fillDays(then, before);
    return currentSeries.map((point, index) => ({
      date: point.date,
      current: point.count,
      previous: previousSeries[index]?.count ?? 0,
    }));
  });
}

export interface MembersPoint {
  date: string;
  joins: number;
  leaves: number;
  total: number | null;
}

export async function loadMembers(guildId: string, period: Period): Promise<MembersPoint[]> {
  return cached('members', guildId, period, async () => {
    const rows = await membersGrowth(db(), repoPeriod(guildId, period));
    const byDay = new Map(rows.map((row) => [row.date, row]));
    let carried: number | null = null;
    return listDays(period).map((date) => {
      const row = byDay.get(date);
      // Dia sem snapshot herda o último conhecido: a linha do total é um nível,
      // não um evento, e cair a zero desenharia um penhasco que não houve.
      carried = row?.total ?? carried;
      return { date, joins: row?.joins ?? 0, leaves: row?.leaves ?? 0, total: carried };
    });
  });
}

export interface HeatmapPoint {
  weekday: number;
  hour: number;
  count: number;
}

export async function loadHeatmap(guildId: string, period: Period): Promise<HeatmapPoint[]> {
  return cached('heatmap', guildId, period, async () =>
    heatmapHourWeekday(db(), repoPeriod(guildId, period)),
  );
}

export interface NamedCount {
  id: string;
  name: string;
  count: number;
}

/** Top canais com o nome resolvido pelo bot; sem bot, mostra o id. */
export async function loadTopChannels(guildId: string, period: Period): Promise<NamedCount[]> {
  const rows = await cached('top-channels', guildId, period, async () =>
    topChannels(db(), repoPeriod(guildId, period), 10),
  );
  if (rows.length === 0) return [];

  const names = await channelNames(guildId);
  return rows.map((row) => ({
    id: row.id,
    name: names.get(row.id) ?? row.id,
    count: row.count,
  }));
}

/**
 * Nomes de canal vêm da API do bot (§5.7) e mudam pouco: 5 min de cache e
 * fallback silencioso para o id quando o bot está fora — um gráfico com id é
 * melhor que um erro (§8).
 */
async function channelNames(guildId: string): Promise<Map<string, string>> {
  try {
    const channels = await unstable_cache(
      async () => internalApi().channels(guildId),
      ['stats', 'channels', guildId],
      { revalidate: 300, tags: [`stats:${guildId}`] },
    )();
    return new Map(channels.map((channel) => [channel.id, `#${channel.name}`]));
  } catch {
    return new Map();
  }
}

export interface StackedSeries {
  /** Chaves na ordem das cores do gráfico. */
  keys: string[];
  rows: Record<string, number | string>[];
}

/** Casos por tipo, empilhados por dia (PRD §6.1). */
export async function loadCasesByType(guildId: string, period: Period): Promise<StackedSeries> {
  return cached('cases-by-type', guildId, period, async () => {
    const points = await seriesByDayAndKey(db(), repoPeriod(guildId, period), 'cases_type');
    const keys = rankKeys(points, 5);
    return { keys, rows: keys.length === 0 ? [] : fillDaysByKey(points, period, keys) };
  });
}

/** Automod por regra; o nome sai da tabela de regras, não do bucket. */
export async function loadAutomodByRule(guildId: string, period: Period): Promise<NamedCount[]> {
  return cached('automod-by-rule', guildId, period, async () => {
    const [rows, rules] = await Promise.all([
      automodByRule(db(), repoPeriod(guildId, period), 10),
      getAutomodRules(db(), guildId),
    ]);
    const names = new Map(rules.map((rule) => [rule.id, rule.name]));
    return rows.map((row) => ({ id: row.id, name: names.get(row.id) ?? row.id, count: row.count }));
  });
}

// ── atividade recente ───────────────────────────────────────────────────────

export interface RecentCase {
  caseNumber: number;
  type: string;
  targetTag: string;
  actorTag: string;
  reason: string;
  createdAt: string;
}

export interface RecentAudit {
  id: number;
  actorTag: string;
  action: string;
  source: AuditSource;
  reason: string | null;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
}

export async function loadRecentCases(guildId: string): Promise<RecentCase[]> {
  return unstable_cache(
    async () => {
      const rows = await listRecentCases(db(), guildId, 10);
      return rows.map((row) => ({
        caseNumber: row.caseNumber,
        type: row.type,
        targetTag: row.targetTag,
        actorTag: row.actorTag,
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
      }));
    },
    ['stats', 'recent-cases', guildId],
    { revalidate: TTL_SECONDS, tags: [`stats:${guildId}`] },
  )();
}

/**
 * Últimas dez ações de **qualquer** origem (PRD §6.1, Etapa 22). Único bloco
 * do dashboard sem `unstable_cache`: é um `LIMIT 10` num índice e é o card que
 * o auto-refresh de 10 s existe para manter vivo — cachear por 60 s aqui
 * anularia o refresh sem economizar nada que importe.
 */
export async function loadRecentAudit(guildId: string): Promise<RecentAudit[]> {
  const rows = await listRecentAudit(db(), guildId, 10);
  return rows.map((row) => ({
    id: row.id,
    actorTag: row.actorTag,
    action: row.action,
    source: row.source,
    reason: row.reason,
    targetType: row.targetType,
    targetId: row.targetId,
    createdAt: row.createdAt.toISOString(),
  }));
}
