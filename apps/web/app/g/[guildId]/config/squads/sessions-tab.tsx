'use client';

import * as React from 'react';
import { formatPlaytime } from '@goodbot/shared';

import { DataTable, type PanelColumnDef } from '@/components/data-table';
import { AvatarSq } from '@/components/retro/avatar-sq';
import { Panel } from '@/components/retro/panel';
import { StatTile } from '@/components/retro/stat-tile';
import { EmptyState, ErrorState } from '@/components/retro/states';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { buildSessionsView, type PlayerRanking, type SquadSessionsData } from '@/lib/squad-sessions';

import { SessionSheet } from './session-sheet';
import { FormationsPanel, GroupsPanel, PairsPanel } from './sessions-stats';
import { SessionsTable } from './sessions-table';

import type { SquadGameRow } from '@/lib/squads';

const ALL = 'all';

/** Presença em porcentagem inteira; `null` (ninguém disse VOU) vira um traço. */
function percent(rate: number | null): string {
  return rate === null ? '—' : `${String(Math.round(rate * 100))}%`;
}

/** O tamanho de grupo em que a pessoa mais jogou. */
function favouriteSize(player: PlayerRanking): string {
  const top = [...player.bySize].sort((a, b) => b.ms - a.ms || b.size - a.size)[0];
  return top ? `${top.label.toUpperCase()} · ${formatPlaytime(top.ms)}` : '—';
}

/**
 * A aba JOGATINAS: o que foi marcado, o que rolou e os números que saem da
 * presença no voice reservado. Nada vem da API do bot: a conta é a mesma regra
 * pura de `shared/squads/stats.ts` que o relatório e o `/squad stats` usam,
 * rodando aqui sobre as linhas que a página leu do banco.
 */
export function SessionsTab({
  games,
  data,
  timeZone,
}: {
  games: SquadGameRow[];
  data: SquadSessionsData;
  timeZone: string;
}) {
  const [gameId, setGameId] = React.useState<string | null>(null);
  const [squadId, setSquadId] = React.useState<string | null>(null);
  const [days, setDays] = React.useState(30);
  const [openId, setOpenId] = React.useState<number | null>(null);

  const game = games.find((entry) => entry.id === gameId) ?? null;
  const squads = React.useMemo(
    () => (gameId ? data.squads.filter((squad) => squad.gameId === gameId) : data.squads),
    [data.squads, gameId],
  );
  // Sem jogo escolhido nenhum grupo é "party cheia": cada jogo tem a sua.
  const partySize = game?.partySize ?? Number.POSITIVE_INFINITY;
  const view = React.useMemo(
    () => buildSessionsView(data, { gameId, squadId, days }, partySize),
    [data, days, gameId, partySize, squadId],
  );

  const nameOf = React.useCallback(
    (userId: string) => data.members[userId]?.displayName ?? userId,
    [data.members],
  );

  const playerColumns = React.useMemo<PanelColumnDef<PlayerRanking>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'JOGADOR',
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <AvatarSq src={row.original.avatarUrl} name={row.original.name} size={24} />
            <span className="flex flex-col">
              <span className="font-bold">{row.original.name}</span>
              {row.original.guestOnly ? <span className="screen-meta">CONVIDADO</span> : null}
            </span>
          </span>
        ),
      },
      {
        accessorKey: 'ms',
        header: 'TEMPO',
        cell: ({ row }) => (
          <span className="tabular-nums">{formatPlaytime(row.original.ms)}</span>
        ),
      },
      {
        accessorKey: 'sessions',
        header: 'JOGATINAS',
        cell: ({ row }) => <span className="tabular-nums">{row.original.sessions}</span>,
      },
      {
        id: 'attendance',
        header: 'PRESENÇA',
        accessorFn: (row) => row.attendanceRate ?? -1,
        cell: ({ row }) => (
          <span className="flex flex-col tabular-nums">
            <span>{percent(row.original.attendanceRate)}</span>
            <span className="screen-meta">
              {row.original.kept}/{row.original.going} VOU
            </span>
          </span>
        ),
      },
      {
        accessorKey: 'noShows',
        header: 'FALTAS',
        cell: ({ row }) => <span className="tabular-nums">{row.original.noShows}</span>,
      },
      {
        id: 'favourite',
        header: 'MAIS JOGOU EM',
        enableSorting: false,
        cell: ({ row }) => <span className="screen-meta">{favouriteSize(row.original)}</span>,
      },
    ],
    [],
  );

  const open = view.rows.find((row) => row.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <Panel title="JOGATINAS.CFG">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="flex flex-col gap-2">
              <Label htmlFor="sessions-game">Jogo</Label>
              <Select
                value={gameId ?? ALL}
                onValueChange={(next) => {
                  setGameId(next === ALL ? null : next);
                  setSquadId(null);
                }}
              >
                <SelectTrigger id="sessions-game" className="w-full sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>TODOS OS JOGOS</SelectItem>
                  {games.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sessions-squad">Squad</Label>
              <Select
                value={squadId ?? ALL}
                onValueChange={(next) => setSquadId(next === ALL ? null : next)}
              >
                <SelectTrigger id="sessions-squad" className="w-full sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>TODOS OS SQUADS</SelectItem>
                  {squads.map((squad) => (
                    <SelectItem key={squad.id} value={squad.id}>
                      {squad.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div role="group" aria-label="Período" className="flex flex-wrap gap-2">
            {[30, data.windowDays].map((option) => {
              const active = days === option;
              return (
                <button
                  key={option}
                  type="button"
                  className={active ? 'tag tag-accent' : 'tag tag-muted'}
                  aria-pressed={active}
                  onClick={() => setDays(option)}
                >
                  {option} DIAS
                </button>
              );
            })}
          </div>
        </div>
        <p className="screen-meta">
          OS NÚMEROS SAEM DA PRESENÇA NO VOICE RESERVADO · DETALHE DE {data.windowDays} DIAS, COMO O
          HISTÓRICO
        </p>
      </Panel>

      {data.membersError ? (
        <ErrorState
          title="NOMES"
          description={`${data.membersError} As tabelas mostram o ID no lugar do nome.`}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="MARCADAS" value={String(view.summary.scheduled)} />
        <StatTile
          label="ROLARAM"
          value={String(view.summary.played)}
          hint={
            view.summary.cancelled > 0 ? `${String(view.summary.cancelled)} CANCELADAS` : undefined
          }
        />
        <StatTile
          label="HORAS"
          value={view.summary.roomMs > 0 ? formatPlaytime(view.summary.roomMs) : '—'}
          hint="TEMPO DE SALA, NÃO A SOMA DE CADA UM"
        />
        <StatTile
          label="PRESENÇA"
          value={percent(view.summary.attendanceRate)}
          hint="VOU CUMPRIDOS SOBRE VOU"
        />
      </div>

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2">
        <FormationsPanel formations={view.formations} />
        <GroupsPanel groups={view.groups} />
      </div>

      <PairsPanel
        pairs={view.pairs}
        ids={view.matrixIds}
        names={nameOf}
        pairMs={view.pairMs}
      />

      <Panel title="JOGADORES.RNK">
        {view.players.length === 0 ? (
          <EmptyState description="Ninguém jogou nesta janela. O ranking conta o tempo no voice reservado das jogatinas." />
        ) : (
          <DataTable
            columns={playerColumns}
            data={view.players}
            searchPlaceholder="BUSCAR JOGADOR"
            emptyDescription="Ninguém jogou nesta janela."
          />
        )}
      </Panel>

      <SessionsTable rows={view.rows} timeZone={timeZone} onOpen={(row) => setOpenId(row.id)} />

      <SessionSheet
        row={open}
        names={nameOf}
        timeZone={timeZone}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}
