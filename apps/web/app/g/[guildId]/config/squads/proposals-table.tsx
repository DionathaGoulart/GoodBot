'use client';

import * as React from 'react';

import { DataTable, type PanelColumnDef } from '@/components/data-table';
import { Panel } from '@/components/retro/panel';
import { Tag } from '@/components/retro/tag';
import { formatDateTime } from '@/lib/squad-labels';

import type { SquadGameRow } from '@/lib/squads';
import type { SquadProposalSummary } from '@goodbot/shared';

/**
 * As propostas que ainda esperam resposta: só contagens, sem quem está nelas.
 * É o que o moderador também vê na aba JOGADORES. Com `gameId`, só as do jogo.
 */
export function ProposalsTable({
  proposals,
  games,
  timeZone,
  gameId = null,
}: {
  proposals: SquadProposalSummary[];
  games: SquadGameRow[];
  timeZone: string;
  gameId?: string | null;
}) {
  const gameName = React.useMemo(
    () => new Map(games.map((game) => [game.id, game.name])),
    [games],
  );
  const rows = React.useMemo(
    () => (gameId ? proposals.filter((proposal) => proposal.gameId === gameId) : proposals),
    [gameId, proposals],
  );

  const columns = React.useMemo<PanelColumnDef<SquadProposalSummary>[]>(
    () => [
      {
        id: 'game',
        header: 'JOGO',
        accessorFn: (row) => gameName.get(row.gameId) ?? '',
        cell: ({ row }) => (
          <span className="font-bold">
            {gameName.get(row.original.gameId) ?? 'JOGO REMOVIDO'}
          </span>
        ),
      },
      {
        id: 'group',
        header: 'TURMA',
        accessorFn: (row) => row.userIds.length,
        cell: ({ row }) => <span className="tabular-nums">{row.original.userIds.length}</span>,
      },
      {
        id: 'accepted',
        header: 'ACEITARAM',
        accessorFn: (row) => row.acceptedIds.length,
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.acceptedIds.length}</span>
        ),
      },
      {
        id: 'declined',
        header: 'PASSARAM',
        accessorFn: (row) => row.declinedIds.length,
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.declinedIds.length}</span>
        ),
      },
      {
        accessorKey: 'squadId',
        header: 'ESTADO',
        cell: ({ row }) => (
          <Tag tone={row.original.squadId ? 'success' : 'muted'}>
            {row.original.squadId ? 'SQUAD FORMADO' : 'SEM ACEITE'}
          </Tag>
        ),
      },
      {
        accessorKey: 'expiresAt',
        header: 'EXPIRA',
        cell: ({ row }) => (
          <time
            className="screen-meta"
            dateTime={row.original.expiresAt}
            title={row.original.expiresAt}
          >
            {formatDateTime(row.original.expiresAt, timeZone)}
          </time>
        ),
      },
    ],
    [gameName, timeZone],
  );

  return (
    <Panel title="PROPOSTAS.LST">
      <DataTable
        columns={columns}
        data={rows}
        emptyDescription="Nenhuma proposta aberta. Elas saem numa thread privada quando o match acha uma turma."
      />
    </Panel>
  );
}
