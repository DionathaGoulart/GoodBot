'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  formatHistory,
  squadHistoryFromSummary,
  type SquadBlockConfig,
  type SquadChannelUsage,
  type SquadSummary,
} from '@goodbot/shared';

import { archiveSquadAction } from '@/app/actions/squads';
import { ConfirmButton } from '@/components/config/confirm-button';
import { DataTable, type PanelColumnDef } from '@/components/data-table';
import { Panel } from '@/components/retro/panel';
import { Tag } from '@/components/retro/tag';
import { describeSession, formatDate, SQUAD_STATUS_LABEL } from '@/lib/squad-labels';
import { useGuildId } from '@/lib/use-guild-id';

import { withId } from './form-data';
import { RenameSheet, type RenameEditing } from './rename-sheet';

import type { SquadGameRow } from '@/lib/squads';

/** §6.7 — canais da guild contra o teto do Discord: cada squad gasta um. */
function ChannelUsage({ usage, squads }: { usage: SquadChannelUsage; squads: number }) {
  const percent = Math.min(100, Math.round((usage.used / usage.limit) * 100));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-3xl font-black tracking-tighter tabular-nums">
          {usage.used}
          <span className="screen-meta"> / {usage.limit} CANAIS</span>
        </span>
        <span className="screen-meta">{squads} SQUADS VIVOS · CADA UM GASTA UM CANAL</span>
      </div>
      <div
        className="usage-track"
        role="progressbar"
        aria-label="Canais usados no servidor"
        aria-valuemin={0}
        aria-valuemax={usage.limit}
        aria-valuenow={usage.used}
      >
        <div className="usage-fill" style={{ width: `${String(percent)}%` }} />
      </div>
    </div>
  );
}

/** Jogatina rolando ou a mais próxima: é a que ordena a coluna. */
function nextSessionTime(squad: SquadSummary): number {
  const next = squad.upcomingSessions[0];
  return next ? Date.parse(next.startsAt) : Number.POSITIVE_INFINITY;
}

/**
 * A aba SQUADS: quem joga junto hoje. Arquivar e renomear passam pelo bot,
 * que tranca o canal, devolve o voice e registra a auditoria; por isso valem
 * para moderador, e não só para admin.
 */
export function SquadsTable({
  squads,
  games,
  channels,
  channelNames,
  blocks,
  timeZone,
  loadedAt,
}: {
  squads: SquadSummary[];
  games: SquadGameRow[];
  channels: SquadChannelUsage | null;
  channelNames: Record<string, string>;
  blocks: SquadBlockConfig[];
  timeZone: string;
  /**
   * Quando o servidor leu o overview. O "há 3 dias" do histórico conta daqui:
   * um `Date.now()` no render daria um texto no servidor e outro no navegador.
   */
  loadedAt: number;
}) {
  const guildId = useGuildId();
  const router = useRouter();
  const [renaming, setRenaming] = React.useState<RenameEditing | null>(null);
  const gameById = React.useMemo(() => new Map(games.map((game) => [game.id, game])), [games]);

  const columns = React.useMemo<PanelColumnDef<SquadSummary>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'NOME',
        cell: ({ row }) => (
          <span className="flex flex-col gap-1">
            <span className="font-bold">{row.original.name}</span>
            <span className="screen-meta">
              {row.original.textChannelId
                ? (channelNames[row.original.textChannelId] ?? row.original.textChannelId)
                : 'SEM CANAL'}
            </span>
          </span>
        ),
      },
      {
        id: 'game',
        header: 'JOGO',
        accessorFn: (row) => gameById.get(row.gameId)?.name ?? '',
        cell: ({ row }) => (
          <span className="screen-meta">
            {gameById.get(row.original.gameId)?.name ?? 'JOGO REMOVIDO'}
          </span>
        ),
      },
      {
        id: 'members',
        header: 'MEMBROS',
        accessorFn: (row) => row.memberIds.length,
        cell: ({ row }) => {
          const size = gameById.get(row.original.gameId)?.groupSize;
          return (
            <span className="tabular-nums">
              {row.original.memberIds.length}
              {size ? `/${String(size)}` : ''}
            </span>
          );
        },
      },
      {
        id: 'nextSession',
        header: 'PRÓXIMA JOGATINA',
        accessorFn: nextSessionTime,
        cell: ({ row }) => {
          const [next, ...rest] = row.original.upcomingSessions;
          if (!next) return <span className="screen-meta">NENHUMA MARCADA</span>;
          return (
            <span className="flex flex-col gap-1">
              <time className="screen-meta" dateTime={next.startsAt} title={next.startsAt}>
                {describeSession(next, timeZone)}
              </time>
              {rest.length > 0 ? (
                <span className="screen-meta">
                  +{rest.length} {rest.length === 1 ? 'MARCADA' : 'MARCADAS'}
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        id: 'history',
        header: 'HISTÓRICO',
        // Squad que joga mais no mês sobe; sem dado do bot fica por último.
        accessorFn: (row) => row.history?.playedLast30d ?? -1,
        cell: ({ row }) => {
          const { history } = row.original;
          if (!history) return <span className="screen-meta">SEM DADO DO BOT</span>;
          return (
            <span className="block max-w-xs text-sm leading-relaxed">
              {formatHistory(squadHistoryFromSummary(history), {
                now: new Date(loadedAt),
                timeZone,
                blocks,
              })}
            </span>
          );
        },
      },
      {
        id: 'voice',
        header: 'VOICE',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.voiceChannelId ? (
            <span className="screen-meta">
              {channelNames[row.original.voiceChannelId] ?? row.original.voiceChannelId}
            </span>
          ) : (
            <Tag tone="warning">SEM SALA</Tag>
          ),
      },
      {
        accessorKey: 'lastConfirmedAt',
        header: 'CONFIRMADO',
        cell: ({ row }) =>
          row.original.lastConfirmedAt ? (
            <time
              className="screen-meta"
              dateTime={row.original.lastConfirmedAt}
              title={row.original.lastConfirmedAt}
            >
              {formatDate(row.original.lastConfirmedAt, timeZone)}
            </time>
          ) : (
            <span className="screen-meta">NUNCA</span>
          ),
      },
      {
        accessorKey: 'status',
        header: 'ESTADO',
        cell: ({ row }) => (
          <Tag tone={row.original.status === 'open' ? 'success' : 'info'}>
            {SQUAD_STATUS_LABEL[row.original.status]}
          </Tag>
        ),
      },
      {
        id: 'controls',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="icon-btn"
              onClick={() => setRenaming({ squadId: row.original.id, name: row.original.name })}
            >
              RENOMEAR
            </button>
            <ConfirmButton
              label="ARQUIVAR"
              successTitle="ARQUIVADO"
              action={() => archiveSquadAction(guildId, withId('squadId', row.original.id))}
              onDone={() => router.refresh()}
            />
          </span>
        ),
      },
    ],
    [blocks, channelNames, gameById, guildId, loadedAt, router, timeZone],
  );

  return (
    <div className="flex flex-col gap-4">
      <Panel title="CANAIS.USO">
        {channels ? (
          <ChannelUsage usage={channels} squads={squads.length} />
        ) : (
          <p className="screen-meta">SEM CONTADOR · O BOT NÃO RESPONDEU</p>
        )}
      </Panel>

      <Panel title="SQUADS.LST">
        <DataTable
          columns={columns}
          data={squads}
          searchPlaceholder="BUSCAR SQUAD"
          emptyDescription="Nenhum squad formado. Eles nascem do primeiro aceite numa proposta."
        />
      </Panel>

      <RenameSheet
        editing={renaming}
        onClose={(changed) => {
          setRenaming(null);
          if (changed) router.refresh();
        }}
      />
    </div>
  );
}
