import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';

import { guilds } from '../schema/guilds';
import { statBuckets } from '../schema/stats';

import type { Db, DbExecutor } from '../client';
import type { StatGranularity, StatKind } from '@cobot/shared';

/** Fuso usado quando a guild não tem `guild_settings` gravado. */
const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/** Um incremento agregado pelo `StatsService` do bot, pronto para o flush. */
export interface StatIncrement {
  guildId: string;
  kind: StatKind;
  key: string;
  bucketStart: Date;
  granularity: StatGranularity;
  count: number;
}

/**
 * Soma os incrementos de um flush em `stat_buckets`. É o **único** caminho de
 * escrita do agregador: nunca há um `INSERT` por mensagem (PRD §7.2).
 *
 * `ON CONFLICT … count + excluded.count` deixa dois processos (ou dois flushes
 * concorrentes) somarem sem se perder.
 */
export async function incrementStatBuckets(
  db: DbExecutor,
  rows: readonly StatIncrement[],
): Promise<number> {
  if (rows.length === 0) return 0;
  await db
    .insert(statBuckets)
    .values(rows.map((row) => ({ ...row })))
    .onConflictDoUpdate({
      target: [
        statBuckets.guildId,
        statBuckets.kind,
        statBuckets.key,
        statBuckets.bucketStart,
        statBuckets.granularity,
      ],
      set: { count: sql`${statBuckets.count} + excluded.count` },
    });
  return rows.length;
}

/**
 * Snapshot: substitui o valor em vez de somar. Usado por `members_total`, que
 * é uma fotografia diária e não um contador de eventos.
 */
export async function setStatBucket(db: DbExecutor, row: StatIncrement): Promise<void> {
  await db
    .insert(statBuckets)
    .values(row)
    .onConflictDoUpdate({
      target: [
        statBuckets.guildId,
        statBuckets.kind,
        statBuckets.key,
        statBuckets.bucketStart,
        statBuckets.granularity,
      ],
      set: { count: sql`excluded.count` },
    });
}

export interface RollupResult {
  /** Linhas diárias criadas ou somadas. */
  rolled: number;
  /** Linhas horárias apagadas. */
  removed: number;
}

/**
 * Agrega os buckets horários anteriores a `before` em buckets diários e apaga
 * os horários (PRD §5.6, retenção de 90 dias). Tudo numa transação: ou o dia
 * existe e a hora sumiu, ou nada mudou.
 *
 * O dia é o dia **da guild** (`timezone`), não UTC — senão os gráficos do
 * painel mudariam de forma ao cruzar a fronteira dos 90 dias.
 */
export async function rollupHourlyBuckets(
  db: Db,
  input: { guildId: string; before: Date; timezone?: string },
): Promise<RollupResult> {
  const tz = input.timezone ?? DEFAULT_TIMEZONE;
  return db.transaction(async (tx) => {
    const rolled = await tx.execute(sql`
      insert into ${statBuckets} (guild_id, kind, key, bucket_start, granularity, count)
      select
        ${statBuckets.guildId},
        ${statBuckets.kind},
        ${statBuckets.key},
        date_trunc('day', ${statBuckets.bucketStart} at time zone ${tz}) at time zone ${tz},
        'day',
        sum(${statBuckets.count})
      from ${statBuckets}
      where ${statBuckets.guildId} = ${input.guildId}
        and ${statBuckets.granularity} = 'hour'
        and ${statBuckets.bucketStart} < ${input.before.toISOString()}::timestamptz
      group by 1, 2, 3, 4
      on conflict (guild_id, kind, key, bucket_start, granularity)
        do update set count = ${statBuckets.count} + excluded.count
    `);

    const removed = await tx.execute(sql`
      delete from ${statBuckets}
      where ${statBuckets.guildId} = ${input.guildId}
        and ${statBuckets.granularity} = 'hour'
        and ${statBuckets.bucketStart} < ${input.before.toISOString()}::timestamptz
    `);

    return { rolled: rowCount(rolled), removed: rowCount(removed) };
  });
}

/** `db.execute` devolve o resultado cru do driver; só o `count` interessa aqui. */
function rowCount(result: unknown): number {
  const value = (result as { count?: unknown }).count;
  return typeof value === 'number' ? value : 0;
}

// ── leitura (tudo por guild e período; o painel nunca lê tabela de evento) ───

export interface StatsPeriod {
  guildId: string;
  /** Início inclusivo. */
  from: Date;
  /** Fim exclusivo. */
  to: Date;
  /** Fuso da guild; decide onde o dia começa. */
  timezone?: string;
}

export interface DayPoint {
  /** `YYYY-MM-DD` no fuso da guild. */
  date: string;
  count: number;
}

/** `where` comum: guild + janela. Toda query de leitura passa por aqui. */
function inPeriod(period: StatsPeriod, kinds: readonly StatKind[]) {
  return and(
    eq(statBuckets.guildId, period.guildId),
    inArray(statBuckets.kind, [...kinds]),
    gte(statBuckets.bucketStart, period.from),
    lt(statBuckets.bucketStart, period.to),
  );
}

function dayExpr(period: StatsPeriod) {
  const tz = period.timezone ?? DEFAULT_TIMEZONE;
  return sql<string>`to_char(${statBuckets.bucketStart} at time zone ${tz}, 'YYYY-MM-DD')`;
}

const total = sql<number>`coalesce(sum(${statBuckets.count}), 0)::int`;

/**
 * `group by 1` em vez de repetir a expressão: o Drizzle renderiza a coluna com
 * o nome da tabela no `group by` e sem ele no `select`, e o Postgres então não
 * reconhece as duas como a mesma expressão.
 */
const GROUP_BY_FIRST = sql`1`;

/** Série diária de um único `kind` (soma horários e diários já agregados). */
async function seriesByDay(
  db: DbExecutor,
  period: StatsPeriod,
  kind: StatKind,
): Promise<DayPoint[]> {
  const day = dayExpr(period);
  const rows = await db
    .select({ date: day, count: total })
    .from(statBuckets)
    .where(inPeriod(period, [kind]))
    .groupBy(GROUP_BY_FIRST)
    .orderBy(GROUP_BY_FIRST);
  return rows.map((row) => ({ date: row.date, count: row.count }));
}

/** Ranking por `key` de um `kind` (top canais, top usuários, comandos…). */
async function rankByKey(
  db: DbExecutor,
  period: StatsPeriod,
  kind: StatKind,
  limit = 10,
): Promise<{ key: string; count: number }[]> {
  return db
    .select({ key: statBuckets.key, count: total })
    .from(statBuckets)
    .where(inPeriod(period, [kind]))
    .groupBy(statBuckets.key)
    .orderBy(desc(total))
    .limit(limit);
}

export async function messagesPerDay(db: DbExecutor, period: StatsPeriod): Promise<DayPoint[]> {
  return seriesByDay(db, period, 'messages_channel');
}

export interface MembersGrowthPoint {
  date: string;
  joins: number;
  leaves: number;
  /** Snapshot do total naquele dia; `null` nos dias sem snapshot. */
  total: number | null;
}

/** Entradas, saídas e o total de membros do dia, na mesma série. */
export async function membersGrowth(
  db: DbExecutor,
  period: StatsPeriod,
): Promise<MembersGrowthPoint[]> {
  const day = dayExpr(period);
  const rows = await db
    .select({
      date: day,
      joins: sql<number>`coalesce(sum(${statBuckets.count}) filter (where ${statBuckets.kind} = 'joins'), 0)::int`,
      leaves: sql<number>`coalesce(sum(${statBuckets.count}) filter (where ${statBuckets.kind} = 'leaves'), 0)::int`,
      total: sql<
        number | null
      >`max(${statBuckets.count}) filter (where ${statBuckets.kind} = 'members_total')::int`,
    })
    .from(statBuckets)
    .where(inPeriod(period, ['joins', 'leaves', 'members_total']))
    .groupBy(GROUP_BY_FIRST)
    .orderBy(GROUP_BY_FIRST);
  return rows.map((row) => ({ ...row, total: row.total ?? null }));
}

export interface HeatmapCell {
  /** 0 = domingo (padrão do `dow` do Postgres). */
  weekday: number;
  hour: number;
  count: number;
}

/**
 * Mapa de calor hora × dia da semana. Só buckets horários entram: depois do
 * rollup a hora deixou de existir, e inventar uma seria mentir no gráfico.
 */
export async function heatmapHourWeekday(
  db: DbExecutor,
  period: StatsPeriod,
): Promise<HeatmapCell[]> {
  const tz = period.timezone ?? DEFAULT_TIMEZONE;
  const local = sql`(${statBuckets.bucketStart} at time zone ${tz})`;
  const weekday = sql<number>`extract(dow from ${local})::int`;
  const hour = sql<number>`extract(hour from ${local})::int`;
  return db
    .select({ weekday, hour, count: total })
    .from(statBuckets)
    .where(and(inPeriod(period, ['messages_channel']), eq(statBuckets.granularity, 'hour')))
    .groupBy(sql`1`, sql`2`)
    .orderBy(sql`1`, sql`2`);
}

export interface RankRow {
  id: string;
  count: number;
}

export async function topChannels(
  db: DbExecutor,
  period: StatsPeriod,
  limit = 10,
): Promise<RankRow[]> {
  const rows = await rankByKey(db, period, 'messages_channel', limit);
  return rows.map((row) => ({ id: row.key, count: row.count }));
}

export async function topUsers(
  db: DbExecutor,
  period: StatsPeriod,
  limit = 10,
): Promise<RankRow[]> {
  const rows = await rankByKey(db, period, 'messages_user', limit);
  return rows.map((row) => ({ id: row.key, count: row.count }));
}

export async function casesByType(
  db: DbExecutor,
  period: StatsPeriod,
  limit = 20,
): Promise<RankRow[]> {
  const rows = await rankByKey(db, period, 'cases_type', limit);
  return rows.map((row) => ({ id: row.key, count: row.count }));
}

export async function automodByRule(
  db: DbExecutor,
  period: StatsPeriod,
  limit = 20,
): Promise<RankRow[]> {
  const rows = await rankByKey(db, period, 'automod_rule', limit);
  return rows.map((row) => ({ id: row.key, count: row.count }));
}

export async function commandsUsage(
  db: DbExecutor,
  period: StatsPeriod,
  limit = 25,
): Promise<RankRow[]> {
  const rows = await rankByKey(db, period, 'commands', limit);
  return rows.map((row) => ({ id: row.key, count: row.count }));
}

export interface TicketsPoint {
  date: string;
  opened: number;
  closed: number;
}

export async function ticketsPerDay(
  db: DbExecutor,
  period: StatsPeriod,
): Promise<TicketsPoint[]> {
  const day = dayExpr(period);
  return db
    .select({
      date: day,
      opened: sql<number>`coalesce(sum(${statBuckets.count}) filter (where ${statBuckets.kind} = 'tickets_open'), 0)::int`,
      closed: sql<number>`coalesce(sum(${statBuckets.count}) filter (where ${statBuckets.kind} = 'tickets_closed'), 0)::int`,
    })
    .from(statBuckets)
    .where(inPeriod(period, ['tickets_open', 'tickets_closed']))
    .groupBy(GROUP_BY_FIRST)
    .orderBy(GROUP_BY_FIRST);
}

/** Números dos stat tiles: valor do período e variação sobre o período anterior. */
export interface SummaryTile {
  current: number;
  previous: number;
  /** `current - previous`. */
  delta: number;
}

export interface StatsSummary {
  messages: SummaryTile;
  joins: SummaryTile;
  leaves: SummaryTile;
  cases: SummaryTile;
  automodHits: SummaryTile;
  commands: SummaryTile;
  ticketsOpened: SummaryTile;
  voiceMinutes: SummaryTile;
  /** Último snapshot de `members_total` até `to`; `null` se ainda não houve. */
  membersTotal: number | null;
}

const SUMMARY_KINDS = [
  'messages_channel',
  'joins',
  'leaves',
  'cases_type',
  'automod_rule',
  'commands',
  'tickets_open',
  'voice_minutes_channel',
] as const satisfies readonly StatKind[];

async function totalsByKind(
  db: DbExecutor,
  period: StatsPeriod,
): Promise<Partial<Record<StatKind, number>>> {
  const rows = await db
    .select({ kind: statBuckets.kind, count: total })
    .from(statBuckets)
    .where(inPeriod(period, SUMMARY_KINDS))
    .groupBy(statBuckets.kind);
  return Object.fromEntries(rows.map((row) => [row.kind, row.count]));
}

/**
 * Resumo do período com o delta contra a janela imediatamente anterior de
 * mesmo tamanho (7 dias vs. os 7 anteriores, por exemplo).
 */
export async function summary(db: DbExecutor, period: StatsPeriod): Promise<StatsSummary> {
  const span = period.to.getTime() - period.from.getTime();
  const previousPeriod: StatsPeriod = {
    ...period,
    from: new Date(period.from.getTime() - span),
    to: period.from,
  };

  const [current, previous, members] = await Promise.all([
    totalsByKind(db, period),
    totalsByKind(db, previousPeriod),
    latestMembersTotal(db, period),
  ]);

  const tile = (kind: StatKind): SummaryTile => {
    const now = current[kind] ?? 0;
    const before = previous[kind] ?? 0;
    return { current: now, previous: before, delta: now - before };
  };

  return {
    messages: tile('messages_channel'),
    joins: tile('joins'),
    leaves: tile('leaves'),
    cases: tile('cases_type'),
    automodHits: tile('automod_rule'),
    commands: tile('commands'),
    ticketsOpened: tile('tickets_open'),
    voiceMinutes: tile('voice_minutes_channel'),
    membersTotal: members,
  };
}

/** Último snapshot de membros dentro do período (`null` se não houver). */
export async function latestMembersTotal(
  db: DbExecutor,
  period: StatsPeriod,
): Promise<number | null> {
  const [row] = await db
    .select({ count: sql<number>`${statBuckets.count}::int` })
    .from(statBuckets)
    .where(
      and(
        eq(statBuckets.guildId, period.guildId),
        eq(statBuckets.kind, 'members_total'),
        lt(statBuckets.bucketStart, period.to),
      ),
    )
    .orderBy(desc(statBuckets.bucketStart))
    .limit(1);
  return row?.count ?? null;
}

/**
 * Garante a linha em `guilds` antes do primeiro flush. Sem isto o FK de
 * `stat_buckets` derruba o lote inteiro numa guild recém-adicionada.
 */
export async function ensureGuildRow(db: DbExecutor, guildId: string): Promise<void> {
  await db
    .insert(guilds)
    .values({ id: guildId, name: '', ownerId: '' })
    .onConflictDoNothing({ target: guilds.id });
}
