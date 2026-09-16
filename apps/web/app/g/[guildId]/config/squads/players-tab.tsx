'use client';

import * as React from 'react';
import {
  evaluateManualMatch,
  MAX_SQUAD_GROUP_SIZE,
  type SquadBlockConfig,
  type SquadManualIssue,
  type SquadProfileStatus,
  type SquadProposalSummary,
} from '@goodbot/shared';
import { useRouter } from 'next/navigation';

import { runSquadMatchAction } from '@/app/actions/squads';
import { ActionButton } from '@/components/config/confirm-button';
import { Panel } from '@/components/retro/panel';
import { EmptyState, ErrorState } from '@/components/retro/states';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { describeManualIssue, SQUAD_PROFILE_STATUS_LABEL } from '@/lib/squad-labels';
import {
  buildPlayerRows,
  playersPeople,
  selectionNotes,
  summarizePlayers,
  type SquadPlayersData,
} from '@/lib/squad-players';
import { useGuildId } from '@/lib/use-guild-id';

import { withId } from './form-data';
import { MatchDialog } from './match-dialog';
import { PlayerSheet } from './player-sheet';
import { PlayersStats } from './players-stats';
import { PlayersTable } from './players-table';
import { ProposalsTable } from './proposals-table';
import { SelectionBar } from './selection-bar';

import type { SquadGameRow } from '@/lib/squads';

const STATUS_FILTERS: { value: SquadProfileStatus | null; label: string }[] = [
  { value: null, label: 'TODOS' },
  { value: 'searching', label: SQUAD_PROFILE_STATUS_LABEL.searching },
  { value: 'in_squad', label: SQUAD_PROFILE_STATUS_LABEL.in_squad },
  { value: 'paused', label: SQUAD_PROFILE_STATUS_LABEL.paused },
];

interface PlayersTabProps {
  games: SquadGameRow[];
  /** `null` para quem não é admin: o servidor nem carrega perfis e nomes. */
  players: SquadPlayersData | null;
  proposals: SquadProposalSummary[];
  blocks: SquadBlockConfig[];
  timeZone: string;
  maxSquadsPerUser: number;
  cooldownDays: number;
}

/**
 * A aba JOGADORES. Para admin: quem tem perfil em cada jogo, contadores, a
 * grade da semana, o perfil completo com as ações de gestão e o match manual
 * pela seleção de linhas. Para moderador, só as propostas abertas.
 */
export function PlayersTab(props: PlayersTabProps) {
  if (!props.players) {
    return (
      <div className="flex flex-col gap-4">
        <p className="screen-meta">A LISTA DE JOGADORES E O MATCH MANUAL SÃO SÓ PARA ADMIN</p>
        <ProposalsTable proposals={props.proposals} games={props.games} timeZone={props.timeZone} />
      </div>
    );
  }
  return <AdminPlayers {...props} players={props.players} />;
}

function AdminPlayers({
  games,
  players,
  proposals,
  blocks,
  timeZone,
  maxSquadsPerUser,
  cooldownDays,
}: PlayersTabProps & { players: SquadPlayersData }) {
  const guildId = useGuildId();
  const router = useRouter();
  const [gameId, setGameId] = React.useState<string | null>(
    () => (games.find((entry) => entry.enabled) ?? games[0])?.id ?? null,
  );
  const [status, setStatus] = React.useState<SquadProfileStatus | null>(null);
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(() => new Set());
  const [openUserId, setOpenUserId] = React.useState<string | null>(null);
  const [proposing, setProposing] = React.useState(false);
  const game = games.find((entry) => entry.id === gameId) ?? null;

  const rows = React.useMemo(
    () => (game ? buildPlayerRows(players, game.id) : []),
    [game, players],
  );
  const visibleRows = React.useMemo(
    () => (status ? rows.filter((row) => row.status === status) : rows),
    [rows, status],
  );
  const summary = React.useMemo(
    () => summarizePlayers(game?.fields ?? [], rows, status ? [status] : undefined),
    [game, rows, status],
  );
  const cooldown = React.useMemo(
    () => new Set(game ? (players.cooldownPairs[game.id] ?? []) : []),
    [game, players.cooldownPairs],
  );
  const notes = React.useMemo(
    () => selectionNotes(game?.fields ?? [], rows, selected, cooldown),
    [cooldown, game, rows, selected],
  );
  const evaluation = React.useMemo(
    () =>
      game && selected.size > 0
        ? evaluateManualMatch({
            game: { partySize: game.partySize, fields: game.fields },
            maxSquadsPerUser,
            userIds: [...selected],
            people: playersPeople(players, game.id),
            cooldownPairs: cooldown,
          })
        : null,
    [cooldown, game, maxSquadsPerUser, players, selected],
  );
  const squadsById = React.useMemo(
    () => new Map(players.liveSquads.map((squad) => [squad.id, squad])),
    [players.liveSquads],
  );

  const nameOf = React.useCallback(
    (userId: string) =>
      rows.find((row) => row.userId === userId)?.name ??
      players.members[userId]?.displayName ??
      userId,
    [players.members, rows],
  );
  const fieldLabel = React.useCallback(
    (key: string) => game?.fields.find((field) => field.key === key)?.label ?? key,
    [game],
  );
  const describe = React.useCallback(
    (issue: SquadManualIssue) =>
      describeManualIssue(issue, {
        nameOf,
        fieldLabel,
        groupSize: game?.groupSize ?? 0,
        partySize: game?.partySize ?? 0,
        maxSquadsPerUser,
        cooldownDays,
        squadOf: (userId) => {
          const squadId = rows.find((row) => row.userId === userId)?.squadIds[0];
          return squadId ? (squadsById.get(squadId)?.name ?? null) : null;
        },
      }),
    [cooldownDays, fieldLabel, game, maxSquadsPerUser, nameOf, rows, squadsById],
  );

  const toggle = React.useCallback((userId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else if (next.size < MAX_SQUAD_GROUP_SIZE) next.add(userId);
      return next;
    });
  }, []);
  const openPlayer = React.useCallback((userId: string) => setOpenUserId(userId), []);
  const clear = React.useCallback(() => setSelected(new Set()), []);

  if (!game) {
    return (
      <Panel title="JOGADORES.CFG">
        <EmptyState description="Cadastre um jogo na aba JOGOS. Os perfis dos jogadores aparecem aqui por jogo." />
      </Panel>
    );
  }

  const openRow = rows.find((row) => row.userId === openUserId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <Panel title="JOGADORES.CFG">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-2">
            <Label htmlFor="players-game">Jogo</Label>
            <Select
              value={game.id}
              onValueChange={(next) => {
                setGameId(next);
                setSelected(new Set());
                setOpenUserId(null);
              }}
            >
              <SelectTrigger id="players-game" className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {games.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name}
                    {entry.enabled ? '' : ' (DESLIGADO)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div role="group" aria-label="Filtrar por status" className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((filter) => {
              const active = status === filter.value;
              return (
                <button
                  key={filter.label}
                  type="button"
                  className={active ? 'tag tag-accent' : 'tag tag-muted'}
                  aria-pressed={active}
                  onClick={() => setStatus(filter.value)}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        </div>
      </Panel>

      <PlayersStats summary={summary} blocks={blocks} />

      <Panel title="JOGADORES.LST">
        {players.membersError ? (
          <ErrorState
            title="NOMES"
            description={`${players.membersError} A tabela mostra o ID no lugar do nome.`}
          />
        ) : null}
        <PlayersTable
          rows={visibleRows}
          squadsById={squadsById}
          selected={selected}
          notes={notes}
          selectionFull={selected.size >= MAX_SQUAD_GROUP_SIZE}
          onToggle={toggle}
          onOpen={openPlayer}
          timeZone={timeZone}
          toolbar={
            <ActionButton
              label="MATCH AUTOMÁTICO"
              busyLabel="CRUZANDO_"
              successTitle="MATCH"
              disabled={!game.enabled}
              action={() => runSquadMatchAction(guildId, withId('gameId', game.id))}
              onDone={() => router.refresh()}
            />
          }
          selectionBar={
            evaluation ? (
              <SelectionBar
                evaluation={evaluation}
                nameOf={nameOf}
                fieldLabel={fieldLabel}
                onPropose={() => setProposing(true)}
                onClear={clear}
              />
            ) : undefined
          }
        />
      </Panel>

      <ProposalsTable proposals={proposals} games={games} timeZone={timeZone} gameId={game.id} />

      <PlayerSheet
        player={openRow}
        game={game}
        data={players}
        blocks={blocks}
        timeZone={timeZone}
        onClose={() => setOpenUserId(null)}
        onChanged={() => router.refresh()}
      />

      <MatchDialog
        open={proposing}
        gameId={game.id}
        userIds={evaluation?.userIds ?? []}
        blocks={blocks}
        nameOf={nameOf}
        describe={describe}
        onClose={(proposed) => {
          setProposing(false);
          if (!proposed) return;
          setSelected(new Set());
          router.refresh();
        }}
      />
    </div>
  );
}
