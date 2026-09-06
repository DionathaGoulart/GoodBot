import { Suspense } from 'react';

import { ActivityHeatmap } from '@/components/charts/activity-heatmap';
import { AutomodByRule } from '@/components/charts/automod-by-rule';
import { CasesByType } from '@/components/charts/cases-by-type';
import { ChartPanel } from '@/components/charts/chart-panel';
import { MembersGrowth } from '@/components/charts/members-growth';
import { MessagesPerDay } from '@/components/charts/messages-per-day';
import { Sparkline } from '@/components/charts/sparkline';
import { TopChannels } from '@/components/charts/top-channels';
import { RecentAuditLog, RecentCases } from '@/components/dashboard/recent-activity';
import { readBotStatus } from '@/components/layout/bot-status';
import { PeriodPicker } from '@/components/period-picker';
import { ScreenHeader } from '@/components/retro/screen-header';
import { StatTile } from '@/components/retro/stat-tile';
import { requireGuildAccess } from '@/lib/auth/require';
import { Skeleton } from '@/components/ui/skeleton';
import {
  guildTimezone,
  loadAutomodByRule,
  loadCasesByType,
  loadHeatmap,
  loadMembers,
  loadMessages,
  loadRecentAudit,
  loadRecentCases,
  loadTiles,
  loadTopChannels,
} from '@/lib/stats';
import { formatPeriodLabel, parseRange, type Period } from '@/lib/stats-period';

export const metadata = { title: 'Dashboard · CoBot' };

const number = new Intl.NumberFormat('pt-BR');

/** `ms` → `3D 04H` / `04H 12M`; o tile do bot mostra há quanto tempo ele vive. */
function uptime(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}D ${String(hours % 24).padStart(2, '0')}H`;
  return `${String(hours).padStart(2, '0')}H ${String(Math.floor(ms / 60_000) % 60).padStart(2, '0')}M`;
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${number.format(value)}`;
}

/**
 * Dashboard (PRD §6.1). Cada bloco é um server component com o seu próprio
 * `Suspense`: o painel pinta o cabeçalho na hora e os números vão chegando,
 * em vez de tudo esperar a query mais lenta.
 */
export default async function DashboardPage({ params, searchParams }: PageProps<'/g/[guildId]'>) {
  const { guildId } = await params;
  await requireGuildAccess(guildId);

  const { range } = await searchParams;
  const period = parseRange(range, { timezone: await guildTimezone(guildId) });

  return (
    <>
      <ScreenHeader
        kicker="PAINEL"
        title="DASHBOARD"
        meta={formatPeriodLabel(period)}
        actions={<PeriodPicker value={period.value} />}
      />

      <Suspense key={`tiles-${period.value}`} fallback={<TilesSkeleton />}>
        <Tiles guildId={guildId} period={period} />
      </Suspense>

      <div className="grid gap-4 xl:grid-cols-2">
        <Suspense key={`messages-${period.value}`} fallback={<BlockSkeleton />}>
          <MessagesBlock guildId={guildId} period={period} />
        </Suspense>
        <Suspense key={`members-${period.value}`} fallback={<BlockSkeleton />}>
          <MembersBlock guildId={guildId} period={period} />
        </Suspense>
        <Suspense key={`heatmap-${period.value}`} fallback={<BlockSkeleton />}>
          <HeatmapBlock guildId={guildId} period={period} />
        </Suspense>
        <Suspense key={`channels-${period.value}`} fallback={<BlockSkeleton />}>
          <ChannelsBlock guildId={guildId} period={period} />
        </Suspense>
        <Suspense key={`cases-${period.value}`} fallback={<BlockSkeleton />}>
          <CasesBlock guildId={guildId} period={period} />
        </Suspense>
        <Suspense key={`automod-${period.value}`} fallback={<BlockSkeleton />}>
          <AutomodBlock guildId={guildId} period={period} />
        </Suspense>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Suspense fallback={<BlockSkeleton />}>
          <RecentCasesBlock guildId={guildId} />
        </Suspense>
        <Suspense fallback={<BlockSkeleton />}>
          <RecentAuditBlock guildId={guildId} />
        </Suspense>
      </div>
    </>
  );
}

interface BlockProps {
  guildId: string;
  period: Period;
}

async function Tiles({ guildId, period }: BlockProps) {
  const [tiles, bot] = await Promise.all([loadTiles(guildId, period), readBotStatus()]);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <StatTile
        label="MEMBROS"
        value={
          tiles.members.total === null
            ? signed(tiles.members.value)
            : number.format(tiles.members.total)
        }
        delta={tiles.members.delta}
        hint={`SALDO ${signed(tiles.members.value)} NO PERÍODO`}
        chart={<Sparkline values={tiles.members.spark} />}
      />
      <StatTile
        label="MENSAGENS"
        value={number.format(tiles.messages.value)}
        delta={tiles.messages.delta}
        hint="VS. PERÍODO ANTERIOR"
        chart={<Sparkline values={tiles.messages.spark} />}
      />
      <StatTile
        label="CASOS"
        value={number.format(tiles.cases.value)}
        delta={tiles.cases.delta}
        hint="VS. PERÍODO ANTERIOR"
        chart={<Sparkline values={tiles.cases.spark} />}
      />
      <StatTile label="TICKETS ABERTOS" value={number.format(tiles.openTickets)} hint="AGORA" />
      <StatTile
        label="AUTOMOD"
        value={number.format(tiles.automod.value)}
        delta={tiles.automod.delta}
        hint="BLOQUEIOS NO PERÍODO"
        chart={<Sparkline values={tiles.automod.spark} />}
      />
      <StatTile
        label="BOT"
        value={bot.uptimeMs === null ? 'OFFLINE' : uptime(bot.uptimeMs)}
        hint={
          bot.uptimeMs === null
            ? 'API NÃO RESPONDE'
            : `PING ${bot.pingMs === null ? '—' : `${bot.pingMs}MS`}`
        }
      />
    </div>
  );
}

async function MessagesBlock({ guildId, period }: BlockProps) {
  const data = await loadMessages(guildId, period);
  const empty = data.every((point) => point.current === 0 && point.previous === 0);
  return (
    <ChartPanel title="MENSAGENS.CHART" empty={empty}>
      <MessagesPerDay data={data} />
    </ChartPanel>
  );
}

async function MembersBlock({ guildId, period }: BlockProps) {
  const data = await loadMembers(guildId, period);
  const empty = data.every(
    (point) => point.joins === 0 && point.leaves === 0 && point.total === null,
  );
  return (
    <ChartPanel title="MEMBROS.CHART" empty={empty}>
      <MembersGrowth data={data} />
    </ChartPanel>
  );
}

async function HeatmapBlock({ guildId, period }: BlockProps) {
  const data = await loadHeatmap(guildId, period);
  return (
    <ChartPanel
      title="ATIVIDADE.MAP"
      meta={<span className="screen-meta">HORA × DIA</span>}
      empty={data.length === 0}
      emptyDescription="O mapa usa buckets por hora, que o bot só guarda por 90 dias. Nada foi registrado nesta janela."
    >
      <ActivityHeatmap data={data} />
    </ChartPanel>
  );
}

async function ChannelsBlock({ guildId, period }: BlockProps) {
  const data = await loadTopChannels(guildId, period);
  return (
    <ChartPanel title="CANAIS.TOP" empty={data.length === 0}>
      <TopChannels data={data} />
    </ChartPanel>
  );
}

async function CasesBlock({ guildId, period }: BlockProps) {
  const data = await loadCasesByType(guildId, period);
  return (
    <ChartPanel title="CASOS.CHART" empty={data.keys.length === 0}>
      <CasesByType data={data} />
    </ChartPanel>
  );
}

async function AutomodBlock({ guildId, period }: BlockProps) {
  const data = await loadAutomodByRule(guildId, period);
  return (
    <ChartPanel title="AUTOMOD.CHART" empty={data.length === 0}>
      <AutomodByRule data={data} />
    </ChartPanel>
  );
}

async function RecentCasesBlock({ guildId }: { guildId: string }) {
  return <RecentCases guildId={guildId} cases={await loadRecentCases(guildId)} />;
}

async function RecentAuditBlock({ guildId }: { guildId: string }) {
  return <RecentAuditLog guildId={guildId} entries={await loadRecentAudit(guildId)} />;
}

function TilesSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-36" />
      ))}
    </div>
  );
}

/** §8 — bloco carregando: listras estáticas com o caret, nunca shimmer. */
function BlockSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <p className="screen-kicker terminal-cursor">CARREGANDO</p>
      <Skeleton className="h-80" />
    </div>
  );
}
