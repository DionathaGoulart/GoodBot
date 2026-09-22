'use client';

import { formatPlaytime, type FormationSummary } from '@goodbot/shared';

import { HeatmapGrid } from '@/components/charts/activity-heatmap';
import { Panel } from '@/components/retro/panel';
import { EmptyState } from '@/components/retro/states';
import { matrixKey, type GroupRanking, type PairRanking } from '@/lib/squad-sessions';

/** "A, B e C". */
function listJoin(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1] ?? ''}`;
}

/**
 * §6.7 — uma barra por tamanho de grupo, contra o tempo de sala. É a mesma
 * leitura do relatório do bot ("1 h 40 de quarteto, 30 min de trio"), só que
 * em barra: aqui dá para comparar de relance quanto o squad joga completo.
 */
export function FormationsPanel({ formations }: { formations: FormationSummary }) {
  const sizes = formations.bySize.filter((size) => size.ms > 0);
  const total = sizes.reduce((sum, size) => sum + size.ms, 0);

  return (
    <Panel title="FORMACOES.STAT">
      {sizes.length === 0 ? (
        <EmptyState description="Ninguém apareceu no voice reservado ainda. As formações saem da presença: quem estava na sala, e por quanto tempo." />
      ) : (
        <div className="flex flex-col gap-2">
          {sizes.map((size) => {
            const percent = total === 0 ? 0 : Math.round((size.ms / total) * 100);
            const party =
              size.party === 'full'
                ? ' (PARTY CHEIA)'
                : size.party === 'over'
                  ? ' (MAIS QUE UMA PARTY)'
                  : '';
            return (
              <div
                key={size.size}
                className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_5rem] items-center gap-3"
              >
                <span className="truncate text-sm uppercase" title={size.label}>
                  {size.label}
                  <span className="text-muted-text">{party}</span>
                </span>
                <div
                  className="usage-track"
                  role="progressbar"
                  aria-label={`Tempo em ${size.label}`}
                  aria-valuemin={0}
                  aria-valuemax={total}
                  aria-valuenow={size.ms}
                >
                  <div className="usage-fill" style={{ width: `${String(percent)}%` }} />
                </div>
                <span className="text-right text-sm tabular-nums">{formatPlaytime(size.ms)}</span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/** Os grupos exatos que mais jogam juntos: só o tempo em que eram exatamente esses. */
export function GroupsPanel({ groups }: { groups: readonly GroupRanking[] }) {
  return (
    <Panel title="GRUPOS.RNK">
      {groups.length === 0 ? (
        <EmptyState description="Ninguém jogou acompanhado ainda. Um grupo conta o tempo em que eram exatamente aquelas pessoas no voice." />
      ) : (
        <ul className="flex flex-col gap-2">
          {groups.map((group) => (
            <li key={group.userIds.join()} className="flex flex-col gap-1">
              <span className="text-sm font-bold">{listJoin(group.names)}</span>
              <span className="screen-meta">
                {group.size.label.toUpperCase()} · {formatPlaytime(group.ms)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="screen-meta">
        O TEMPO DE UM GRUPO É SÓ O DE QUANDO ERAM EXATAMENTE ESSAS PESSOAS NA SALA
      </p>
    </Panel>
  );
}

/**
 * Quem joga com quem: a matriz de todas as duplas do ranking e a lista das que
 * mais jogam juntas. Diferente do grupo exato, a dupla conta o tempo lado a
 * lado com ou sem mais gente no voice.
 */
export function PairsPanel({
  pairs,
  ids,
  names,
  pairMs,
}: {
  pairs: readonly PairRanking[];
  /** Os ids da matriz, do que mais jogou. */
  ids: readonly string[];
  names: (userId: string) => string;
  pairMs: Map<string, number>;
}) {
  const labels = ids.map((id) => names(id).slice(0, 8).toUpperCase());
  const msOf = (row: number, column: number) => {
    const a = ids[row];
    const b = ids[column];
    if (!a || !b || a === b) return 0;
    return pairMs.get(matrixKey(a, b)) ?? 0;
  };

  return (
    <Panel title="DUPLAS.MAP">
      {pairs.length === 0 ? (
        <EmptyState description="Ninguém dividiu o voice com mais alguém ainda. A dupla conta o tempo juntos, com ou sem mais gente na sala." />
      ) : (
        <>
          {ids.length > 1 ? (
            <HeatmapGrid
              rows={labels}
              columns={labels}
              value={(row, column) => Math.round(msOf(row, column) / 60_000)}
              tooltip={(row, column) => {
                const a = labels[row] ?? '';
                const b = labels[column] ?? '';
                if (row === column) return `${a} · A MESMA PESSOA`;
                const ms = msOf(row, column);
                return `${a} × ${b} · ${ms === 0 ? 'NUNCA JOGARAM JUNTOS' : formatPlaytime(ms)}`;
              }}
              legendUnit="MIN"
            />
          ) : null}
          <ul className="flex flex-col gap-2">
            {pairs.map((pair) => (
              <li key={pair.userIds.join()} className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-bold">{pair.names.join(' e ')}</span>
                <span className="screen-meta">{formatPlaytime(pair.ms)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
