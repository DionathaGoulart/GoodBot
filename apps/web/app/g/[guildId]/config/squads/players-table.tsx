'use client';

import * as React from 'react';
import { countCells, type SquadProfileStatus } from '@goodbot/shared';

import { DataTable, type PanelColumnDef } from '@/components/data-table';
import { AvatarSq } from '@/components/retro/avatar-sq';
import { Tag, type TagTone } from '@/components/retro/tag';
import { Checkbox } from '@/components/ui/checkbox';
import { formatDate, SQUAD_PROFILE_STATUS_LABEL } from '@/lib/squad-labels';

import type { LiveSquadRow, PlayerRow, SelectionNote } from '@/lib/squad-players';

/** Por que a linha de quem está num squad do jogo não pode ser marcada. */
export const IN_SQUAD_REASON = 'EM SQUAD DESTE JOGO: TIRE DO SQUAD ANTES DE PROPOR';

export const PLAYER_STATUS_TONE: Record<SquadProfileStatus, TagTone> = {
  searching: 'success',
  in_squad: 'info',
  paused: 'muted',
};

function NoteCell({ note }: { note: SelectionNote }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="font-bold tabular-nums">{note.score}</span>
      {note.hardConflict ? <Tag tone="error">PRECISA BATER</Tag> : null}
      {note.noCommonCell ? <Tag tone="warning">0 FAIXAS</Tag> : null}
      {note.cooldown ? <Tag tone="warning">PAUSA</Tag> : null}
      {note.paused ? <Tag tone="muted">PAUSADO</Tag> : null}
    </span>
  );
}

/**
 * JOGADORES.LST: um perfil por linha, com a caixa de seleção do match manual.
 * A coluna NOTA só se preenche com alguém marcado: é a soma das notas de dupla
 * contra cada selecionado, e ordenar por ela acha quem combina com a turma.
 */
export function PlayersTable({
  rows,
  squadsById,
  selected,
  notes,
  selectionFull,
  onToggle,
  onOpen,
  toolbar,
  selectionBar,
  timeZone,
}: {
  rows: PlayerRow[];
  squadsById: ReadonlyMap<string, LiveSquadRow>;
  selected: ReadonlySet<string>;
  notes: ReadonlyMap<string, SelectionNote>;
  /** Chegou no teto da seleção: só quem já está marcado pode ser desmarcado. */
  selectionFull: boolean;
  onToggle: (userId: string) => void;
  onOpen: (userId: string) => void;
  toolbar?: React.ReactNode;
  selectionBar?: React.ReactNode;
  timeZone: string;
}) {
  const columns = React.useMemo<PanelColumnDef<PlayerRow>[]>(
    () => [
      {
        id: 'select',
        header: '',
        enableSorting: false,
        cell: ({ row }) => {
          const player = row.original;
          const checked = selected.has(player.userId);
          const reasonId = `select-reason-${player.userId}`;
          return (
            <span className="flex items-center" title={player.inSquadInGame ? IN_SQUAD_REASON : undefined}>
              <Checkbox
                aria-label={`Selecionar ${player.name}`}
                aria-describedby={player.inSquadInGame ? reasonId : undefined}
                checked={checked}
                disabled={player.inSquadInGame || (!checked && selectionFull)}
                onCheckedChange={() => onToggle(player.userId)}
              />
              {player.inSquadInGame ? (
                <span id={reasonId} className="sr-only">
                  {IN_SQUAD_REASON}
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        id: 'player',
        header: 'JOGADOR',
        accessorFn: (row) => `${row.name} ${row.username ?? ''} ${row.userId}`,
        cell: ({ row }) => {
          const player = row.original;
          return (
            <span className="flex items-center gap-2">
              <AvatarSq src={player.avatarUrl} name={player.name} size={24} />
              <span className="flex min-w-0 flex-col">
                <span className="flex flex-wrap items-center gap-1">
                  <span className="font-bold">{player.name}</span>
                  {player.inGuild === false ? <Tag tone="muted">SAIU</Tag> : null}
                </span>
                <span className="screen-meta select-all">
                  {player.username ? `@${player.username}` : player.userId}
                </span>
              </span>
            </span>
          );
        },
      },
      {
        accessorKey: 'status',
        header: 'STATUS',
        cell: ({ row }) => (
          <Tag tone={PLAYER_STATUS_TONE[row.original.status]}>
            {SQUAD_PROFILE_STATUS_LABEL[row.original.status]}
          </Tag>
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
        id: 'note',
        header: 'NOTA',
        accessorFn: (row) =>
          selected.has(row.userId)
            ? Number.MAX_SAFE_INTEGER
            : (notes.get(row.userId)?.score ?? -1),
        cell: ({ row }) => {
          if (selected.size === 0) return null;
          if (selected.has(row.original.userId)) return <Tag tone="accent">SELECIONADO</Tag>;
          const note = notes.get(row.original.userId);
          return note ? <NoteCell note={note} /> : null;
        },
      },
      {
        id: 'situation',
        header: 'SITUAÇÃO',
        enableSorting: false,
        cell: ({ row }) => {
          const player = row.original;
          return (
            <span className="flex flex-wrap gap-1">
              {player.squadIds.map((squadId) => (
                <Tag key={squadId} tone="info">
                  SQUAD {squadsById.get(squadId)?.name.toUpperCase() ?? ''}
                </Tag>
              ))}
              {player.openProposalIds.length > 0 ? <Tag tone="warning">PROPOSTA</Tag> : null}
              {player.pendingRequestSquadIds.length > 0 ? <Tag tone="warning">PEDIDO</Tag> : null}
            </span>
          );
        },
      },
      {
        accessorKey: 'updatedAt',
        header: 'ATUALIZADO',
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
        id: 'open',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <button
            type="button"
            className="icon-btn"
            aria-label={`VER ${row.original.name}`}
            onClick={() => onOpen(row.original.userId)}
          >
            VER
          </button>
        ),
      },
    ],
    [notes, onOpen, onToggle, selected, selectionFull, squadsById, timeZone],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="BUSCAR JOGADOR"
      toolbar={toolbar}
      selectionBar={selectionBar}
      emptyDescription="Nenhum perfil neste jogo com esse filtro. O perfil nasce quando o membro responde as perguntas pelo botão da mensagem fixa."
    />
  );
}
