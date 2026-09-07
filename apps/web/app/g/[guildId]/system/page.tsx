import { Panel } from '@/components/retro/panel';
import { ScreenHeader } from '@/components/retro/screen-header';
import { ErrorState } from '@/components/retro/states';
import { StatTile } from '@/components/retro/stat-tile';
import { requireGuildAccess } from '@/lib/auth/require';
import { formatBytes, formatUptime, loadSystemHealth } from '@/lib/system';

import type { HealthResponse } from '@cobot/shared';

export const metadata = { title: 'Saúde · CoBot' };

// A saúde é sempre a de agora: nada de cache entre requisições.
export const dynamic = 'force-dynamic';

/**
 * Card "Saúde" (PRD §11). Só `owner`: mostra memória, filas, versão da imagem
 * e o último backup — informação de operação, não de moderação.
 */
export default async function SystemPage({ params }: PageProps<'/g/[guildId]/system'>) {
  const { guildId } = await params;
  await requireGuildAccess(guildId, 'owner');

  const { health, roundTripMs, error } = await loadSystemHealth();

  return (
    <>
      <ScreenHeader
        kicker="SERVIDOR"
        title="Saúde"
        meta="Estado do processo do bot, das filas e do último backup. Atualiza a cada visita."
      />

      {health === null ? (
        <Panel title="SAUDE.SYS" tone="error">
          <ErrorState
            title="BOT FORA"
            description={error ?? 'A API do bot não respondeu.'}
          />
        </Panel>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="UPTIME"
              value={formatUptime(health.uptimeMs)}
              hint={`v${health.version} · ${health.process?.commit ?? 'local'}`}
            />
            <StatTile
              label="MEMÓRIA RSS"
              value={health.process ? formatBytes(health.process.rssBytes) : '—'}
              hint={
                health.process
                  ? `heap ${formatBytes(health.process.heapUsedBytes)} · limite 384 MB`
                  : undefined
              }
            />
            <StatTile
              label="PING DO GATEWAY"
              value={health.gateway.pingMs === null ? '—' : `${String(health.gateway.pingMs)} ms`}
              hint={`gateway ${health.gateway.status}`}
            />
            <StatTile
              label="LATÊNCIA WEB→BOT"
              value={roundTripMs === null ? '—' : `${String(roundTripMs)} ms`}
              hint={
                health.database.latencyMs === null
                  ? 'banco fora'
                  : `banco ${String(health.database.latencyMs)} ms`
              }
            />
          </div>

          <Panel title="FILAS.SYS">
            <Rows
              rows={[
                ['Fila de logs', queueLabel(health.queues?.logQueue)],
                ['Cache de mensagens', queueLabel(health.queues?.messageCache)],
                ['Estatísticas', queueLabel(health.queues?.stats)],
              ]}
            />
          </Panel>

          <Panel title="BACKUP.SYS" tone={health.backup?.fresh === false ? 'error' : undefined}>
            <Rows rows={backupRows(health.backup)} />
          </Panel>

          <Panel title="PROCESSO.SYS">
            <Rows
              rows={[
                ['Versão', `v${health.version}`],
                ['Commit', health.process?.commit ?? 'local (sem GIT_SHA)'],
                ['Node', health.process?.nodeVersion ?? '—'],
                ['Guilds em cache', `${String(health.guilds.cached)}/${String(health.guilds.expected)}`],
              ]}
            />
          </Panel>
        </>
      )}
    </>
  );
}

/** Um valor de fila; `—` quando o bot é antigo demais para reportar. */
function queueLabel(value: number | undefined): string {
  return value === undefined ? '—' : String(value);
}

function backupRows(backup: HealthResponse['backup']): [string, string][] {
  if (!backup) {
    return [['Último dump', 'sem volume de backup montado (BACKUP_DIR)']];
  }
  return [
    [
      'Último dump',
      backup.at === null
        ? 'nenhum dump encontrado'
        : new Date(backup.at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    ],
    ['Tamanho', backup.sizeBytes === null ? '—' : formatBytes(backup.sizeBytes)],
    ['Estado', backup.fresh ? 'em dia (< 48h)' : 'ATRASADO — veja o runbook'],
  ];
}

/** Lista `rótulo → valor` em duas colunas, no formato de tela do styleguide. */
function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-1">
          <dt className="section-label sigil">{label}</dt>
          <dd className="text-sm tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
