'use client';

import * as React from 'react';
import { countCells } from '@goodbot/shared';
import { useRouter } from 'next/navigation';

import { runSquadMatchAction } from '@/app/actions/squads';
import { ActionButton } from '@/components/config/confirm-button';
import { DataTable, type PanelColumnDef } from '@/components/data-table';
import { Panel } from '@/components/retro/panel';
import { Tag } from '@/components/retro/tag';
import { formatDate, formatDateTime, summarizeAvailability } from '@/lib/squad-labels';
import { useGuildId } from '@/lib/use-guild-id';

import { withId } from './form-data';

import type { SearchingProfileRow, SquadGameRow } from '@/lib/squads';
import type { SquadBlockConfig, SquadProposalSummary } from '@goodbot/shared';

/**
 * A aba PROCURANDO: quem está na fila do match e as propostas que ainda
 * esperam resposta. O match roda sozinho a cada perfil salvo e uma vez por
 * dia; o botão é para quem mexeu num jogo ou na config e não quer esperar.
 */
export function SearchingTable({
  profiles,
  proposals,
  games,
  blocks,
  timeZone,
  readOnly,
}: {
  profiles: SearchingProfileRow[];
  proposals: SquadProposalSummary[];
  games: SquadGameRow[];
  blocks: SquadBlockConfig[];
  timeZone: string;
  readOnly: boolean;
}) {
  const guildId = useGuildId();
  const router = useRouter();
  const gameName = React.useMemo(
    () => new Map(games.map((game) => [game.id, game.name])),
    [games],
  );

  const profileColumns = React.useMemo<PanelColumnDef<SearchingProfileRow>[]>(
    () => [
      {
        accessorKey: 'userId',
        header: 'MEMBRO',
        cell: ({ row }) => <span className="screen-meta select-all">{row.original.userId}</span>,
      },
      {
        id: 'game',
        header: 'JOGO',
        accessorFn: (row) => gameName.get(row.gameId) ?? '',
        cell: ({ row }) => (
          <span className="screen-meta">
            {gameName.get(row.original.gameId) ?? 'JOGO REMOVIDO'}
          </span>
        ),
      },
      {
        id: 'availability',
        header: 'GRADE',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="screen-meta">
            {summarizeAvailability(row.original.availability, blocks)}
          </span>
        ),
      },
      {
        id: 'cells',
        header: 'FAIXAS',
        accessorFn: (row) => countCells(row.availability),
        cell: ({ row }) => (
          <span className="tabular-nums">{countCells(row.original.availability)}</span>
        ),
      },
      {
        accessorKey: 'updatedAt',
        header: 'PERFIL ATUALIZADO',
        cell: ({ row }) => (
          <time
            className="screen-meta"
            dateTime={row.original.updatedAt}
            title={row.original.updatedAt}
          >
            {formatDate(row.original.updatedAt, timeZone)}
          </time>
        ),
      },
      {
        accessorKey: 'lastMatchedAt',
        header: 'ÚLTIMA PROPOSTA',
        cell: ({ row }) =>
          row.original.lastMatchedAt ? (
            <time
              className="screen-meta"
              dateTime={row.original.lastMatchedAt}
              title={row.original.lastMatchedAt}
            >
              {formatDateTime(row.original.lastMatchedAt, timeZone)}
            </time>
          ) : (
            <span className="screen-meta">NUNCA</span>
          ),
      },
    ],
    [blocks, gameName, timeZone],
  );

  const proposalColumns = React.useMemo<PanelColumnDef<SquadProposalSummary>[]>(
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

  const enabledGames = games.filter((game) => game.enabled);

  return (
    <div className="flex flex-col gap-4">
      <Panel title="PROCURANDO.LST">
        <DataTable
          columns={profileColumns}
          data={profiles}
          searchPlaceholder="BUSCAR MEMBRO"
          toolbar={
            readOnly || enabledGames.length === 0 ? undefined : (
              <span className="flex flex-wrap gap-2">
                {enabledGames.map((game) => (
                  <ActionButton
                    key={game.id}
                    label={`MATCH · ${game.name.toUpperCase()}`}
                    busyLabel="CRUZANDO_"
                    successTitle="MATCH"
                    action={() => runSquadMatchAction(guildId, withId('gameId', game.id))}
                    onDone={() => router.refresh()}
                  />
                ))}
              </span>
            )
          }
          emptyDescription="Ninguém procurando. O perfil entra na fila quando o membro salva a grade de horários."
        />
      </Panel>

      <Panel title="PROPOSTAS.LST">
        <DataTable
          columns={proposalColumns}
          data={proposals}
          emptyDescription="Nenhuma proposta aberta. Elas saem numa thread privada quando o match acha uma turma."
        />
      </Panel>
    </div>
  );
}
