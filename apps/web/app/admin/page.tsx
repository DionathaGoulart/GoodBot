import { Panel } from '@/components/retro/panel';
import { ScreenHeader } from '@/components/retro/screen-header';
import { EmptyState, ErrorState } from '@/components/retro/states';
import { StatTile } from '@/components/retro/stat-tile';
import { Tag } from '@/components/retro/tag';
import { requireBotOwner } from '@/lib/auth/owner';
import { loadAdminGuilds, loadAdminSystem, queueOf, USAGE_WINDOW_MS } from '@/lib/admin';
import { formatBytes, formatUptime } from '@/lib/system';

import type { AdminGuildRow } from '@/lib/admin';
import type { HealthResponse } from '@goodbot/shared';

export const metadata = { title: 'Saúde · Admin · Goodbot' };

// Estado de agora: nada aqui pode ser prerenderizado nem cacheado.
export const dynamic = 'force-dynamic';

/** O container tem 384 MB (`infra/docker-compose.yml`); é esse o teto real. */
const CONTAINER_MEMORY_BYTES = 384 * 1024 * 1024;

/** A partir daqui a RAM deixa de ser número e vira aviso. */
const MEMORY_WARNING_RATIO = 0.8;

/**
 * "Saúde e uso" (plano, Etapa 4, item 3). É a tela que avisa quando a VM está
 * chegando no limite — por isso a memória tem faixa e não só valor, e por isso
 * "guilds em cache vs esperadas" fica ao lado dela: as duas contam a mesma
 * história de capacidade por ângulos diferentes.
 */
export default async function AdminPage() {
  await requireBotOwner();

  const [{ health, diagnostics, maintenance, roundTripMs, error }, { rows, botError }] =
    await Promise.all([loadAdminSystem(), loadAdminGuilds()]);

  const dias = Math.round(USAGE_WINDOW_MS / (24 * 60 * 60 * 1000));
  const atendidos = rows.filter((row) => row.served);
  const fila = queueOf(rows);
  const rss = health?.process?.rssBytes ?? null;
  const memoriaApertada = rss !== null && rss > CONTAINER_MEMORY_BYTES * MEMORY_WARNING_RATIO;

  return (
    <>
      <ScreenHeader
        kicker="ADMIN"
        title="Saúde e uso"
        meta={`Estado do processo, capacidade e o que os servidores usaram nos últimos ${String(dias)} dias.`}
      />

      {maintenance?.enabled ? (
        <div
          role="status"
          className="border-2 border-warning bg-base-200 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-warning-text"
        >
          ! MODO MANUTENÇÃO LIGADO — O BOT ESTÁ RECUSANDO INTERAÇÕES
        </div>
      ) : null}

      {error !== null ? (
        <Panel title="SAUDE.SYS" tone="error">
          <ErrorState
            title="BOT FORA"
            description={`${error} A fila de aprovação abaixo continua funcionando: aprovar é uma escrita no banco, e o bot a lê quando voltar.`}
          />
        </Panel>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="SERVIDORES ATENDIDOS"
              value={String(atendidos.length)}
              hint={`${String(rows.length)} no registro · ${String(fila.length)} na fila · teto 100`}
            />
            <StatTile
              label="MEMÓRIA RSS"
              value={rss === null ? '—' : formatBytes(rss)}
              hint={
                rss === null
                  ? undefined
                  : `${String(Math.round((rss / CONTAINER_MEMORY_BYTES) * 100))}% de 384 MB${memoriaApertada ? ' — APERTADO' : ''}`
              }
            />
            <StatTile
              label="GUILDS EM CACHE"
              value={health ? `${String(health.guilds.cached)}/${String(health.guilds.expected)}` : '—'}
              hint={
                health && health.guilds.cached < health.guilds.expected
                  ? 'menos do que o registro espera — veja Servidores'
                  : 'bate com o registro'
              }
            />
            <StatTile
              label="UPTIME"
              value={health ? formatUptime(health.uptimeMs) : '—'}
              hint={
                health
                  ? `v${health.version} · ${health.process?.commit ?? 'local'} · web→bot ${roundTripMs === null ? '—' : `${String(roundTripMs)} ms`}`
                  : undefined
              }
            />
          </div>

          <Panel title="USO.LOG">
            <p className="screen-meta">
              COMANDOS E MENSAGENS POR SERVIDOR NOS ÚLTIMOS {dias} DIAS
            </p>
            {botError !== null ? (
              <p className="screen-meta">
                O BOT NÃO RESPONDEU: OS NOMES CAEM PARA O ID, MAS OS NÚMEROS SÃO DO BANCO
              </p>
            ) : null}
            <UsoTable rows={rows} />
          </Panel>

          <Panel
            title="ERROS.LOG"
            tone={diagnostics && diagnostics.recent.length > 0 ? 'error' : undefined}
          >
            <Diagnostics diagnostics={diagnostics} />
          </Panel>

          <Panel title="PROCESSO.SYS">
            <Rows rows={processoRows(health, maintenance?.enabled ?? false)} />
          </Panel>
        </>
      )}
    </>
  );
}

/** Uso por servidor, do que mais usou para o que menos usou. */
function UsoTable({ rows }: { rows: readonly AdminGuildRow[] }) {
  const usados = [...rows]
    .filter((row) => row.usage.commands > 0 || row.usage.messages > 0)
    .sort((a, b) => b.usage.commands - a.usage.commands || b.usage.messages - a.usage.messages);

  if (usados.length === 0) {
    return (
      <EmptyState
        title="SEM USO"
        description="Nenhum servidor registrou comando ou mensagem na janela."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-base-300 bg-base-100 text-left">
            <th className="section-label px-3 py-2">Servidor</th>
            <th className="section-label px-3 py-2 text-right">Comandos</th>
            <th className="section-label px-3 py-2 text-right">Mensagens</th>
            <th className="section-label px-3 py-2 text-right">Membros</th>
          </tr>
        </thead>
        <tbody>
          {usados.map((row) => (
            <tr key={row.guildId} className="border-b border-base-300/30">
              <td className="px-3 py-2">
                <span className="block truncate font-bold">{row.live?.name ?? row.guildId}</span>
                <span className="screen-meta select-all">{row.guildId}</span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{row.usage.commands}</td>
              <td className="px-3 py-2 text-right tabular-nums">{row.usage.messages}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {row.live ? row.live.memberCount : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Erros recentes do processo; o total por escopo fica ao lado como contexto. */
function Diagnostics({
  diagnostics,
}: {
  diagnostics: Awaited<ReturnType<typeof loadAdminSystem>>['diagnostics'];
}) {
  if (!diagnostics) {
    return <p className="screen-meta">O BOT NÃO REPORTOU DIAGNÓSTICO</p>;
  }
  if (diagnostics.recent.length === 0) {
    return (
      <EmptyState
        title="SEM ERROS"
        description={`Nenhum erro desde o último boot. ${String(diagnostics.commandsTotal)} comandos executados até o fim.`}
      />
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {diagnostics.byScope.map((scope) => (
          <Tag key={scope.scope} tone="error">
            {scope.scope} {scope.count}
          </Tag>
        ))}
      </div>
      <ul className="flex flex-col gap-2">
        {diagnostics.recent.map((entry, index) => (
          <li
            key={`${entry.at}-${String(index)}`}
            className="flex flex-col gap-1 border-2 border-base-300 bg-base-100 px-3 py-2"
          >
            <span className="screen-meta">
              {new Date(entry.at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} ·{' '}
              {entry.scope}
              {entry.where ? ` · ${entry.where}` : ''}
              {entry.guildId ? ` · ${entry.guildId}` : ''}
            </span>
            <span className="break-words text-sm">{entry.message}</span>
          </li>
        ))}
      </ul>
      <p className="screen-meta">
        A LISTA ZERA A CADA REINÍCIO. A STACK COMPLETA ESTÁ NO LOG DA VM
      </p>
    </>
  );
}

function processoRows(health: HealthResponse | null, maintenance: boolean): [string, string][] {
  if (!health) return [['Processo', 'o bot não respondeu']];
  return [
    ['Versão', `v${health.version}`],
    ['Commit', health.process?.commit ?? 'local (sem GIT_SHA)'],
    ['Node', health.process?.nodeVersion ?? '—'],
    [
      'Gateway',
      `${health.gateway.status}${health.gateway.pingMs === null ? '' : ` · ${String(health.gateway.pingMs)} ms`}`,
    ],
    [
      'Banco',
      health.database.ok
        ? `ok${health.database.latencyMs === null ? '' : ` · ${String(health.database.latencyMs)} ms`}`
        : 'FORA',
    ],
    ['Manutenção', maintenance ? 'LIGADA' : 'desligada'],
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
