'use client';

import * as React from 'react';
import { formatPlaytime } from '@goodbot/shared';

import { DataTable, type PanelColumnDef } from '@/components/data-table';
import { Panel } from '@/components/retro/panel';
import { Tag } from '@/components/retro/tag';
import { formatSessionStart } from '@/lib/squad-labels';

import type { SessionStatus, SessionTableRow } from '@/lib/squad-sessions';
import type { TagTone } from '@/components/retro/tag';

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  scheduled: 'MARCADA',
  running: 'ROLANDO',
  played: 'ROLOU',
  no_show: 'NÃO ROLOU',
  cancelled: 'CANCELADA',
};

export const SESSION_STATUS_TONE: Record<SessionStatus, TagTone> = {
  scheduled: 'info',
  running: 'accent',
  played: 'success',
  no_show: 'warning',
  cancelled: 'muted',
};

/**
 * As jogatinas da janela, da mais recente. Clicar na linha abre o relatório
 * daquela jogatina, o mesmo que o bot posta no canal do squad quando ela
 * encerra.
 */
export function SessionsTable({
  rows,
  timeZone,
  onOpen,
}: {
  rows: SessionTableRow[];
  timeZone: string;
  onOpen: (row: SessionTableRow) => void;
}) {
  const columns = React.useMemo<PanelColumnDef<SessionTableRow>[]>(
    () => [
      {
        id: 'when',
        header: 'QUANDO',
        accessorFn: (row) => Date.parse(row.startsAt),
        cell: ({ row }) => (
          <time className="screen-meta" dateTime={row.original.startsAt} title={row.original.startsAt}>
            {formatSessionStart(row.original.startsAt, timeZone)}
          </time>
        ),
      },
      {
        accessorKey: 'squadName',
        header: 'SQUAD',
        cell: ({ row }) => <span className="font-bold">{row.original.squadName}</span>,
      },
      {
        accessorKey: 'status',
        header: 'ESTADO',
        cell: ({ row }) => (
          <Tag tone={SESSION_STATUS_TONE[row.original.status]}>
            {SESSION_STATUS_LABEL[row.original.status]}
          </Tag>
        ),
      },
      {
        accessorKey: 'durationMs',
        header: 'DUROU',
        cell: ({ row }) =>
          row.original.durationMs > 0 ? (
            <span className="tabular-nums">{formatPlaytime(row.original.durationMs)}</span>
          ) : (
            <span className="screen-meta">SEM MEDIDA</span>
          ),
      },
      {
        accessorKey: 'playedCount',
        header: 'FORAM',
        cell: ({ row }) => (
          <span className="flex flex-col tabular-nums">
            <span>
              {row.original.playedCount}/{row.original.goingCount}
            </span>
            {row.original.guestCount > 0 ? (
              <span className="screen-meta">+{row.original.guestCount} CONVIDADO</span>
            ) : null}
          </span>
        ),
      },
      {
        accessorKey: 'noShowCount',
        header: 'FALTAS',
        cell: ({ row }) =>
          row.original.noShowCount > 0 ? (
            <Tag tone="warning">{row.original.noShowCount}</Tag>
          ) : (
            <span className="screen-meta">NENHUMA</span>
          ),
      },
    ],
    [timeZone],
  );

  return (
    <Panel title="JOGATINAS.LOG">
      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="BUSCAR SQUAD"
        emptyDescription="Nenhuma jogatina neste filtro. Elas nascem do /bora ou do botão BORA no guia do squad."
        onRowClick={onOpen}
      />
    </Panel>
  );
}
