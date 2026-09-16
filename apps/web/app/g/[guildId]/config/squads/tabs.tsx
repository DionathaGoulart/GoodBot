'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import {
  deleteSquadGameAction,
  publishSquadSearchMessageAction,
  runSquadMatchAction,
} from '@/app/actions/squads';
import { ActionButton, ConfirmButton } from '@/components/config/confirm-button';
import { DataTable, type PanelColumnDef } from '@/components/data-table';
import { Panel } from '@/components/retro/panel';
import { Tag } from '@/components/retro/tag';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useGuildId } from '@/lib/use-guild-id';

import { withId } from './form-data';
import { EMPTY_GAME, GameSheet, type GameEditing } from './game-sheet';
import { PlayersTab } from './players-tab';
import { SquadsTable } from './squads-table';

import type { SquadPlayersData } from '@/lib/squad-players';
import type { SquadGameRow, SquadsOverviewData } from '@/lib/squads';
import type { SquadBlockConfig } from '@goodbot/shared';

/** A mensagem fixa: é por ela que os membros entram no módulo. */
function SearchMessagePanel({
  channelId,
  messageId,
  channelNames,
  enabledGames,
  readOnly,
}: {
  channelId: string | null;
  messageId: string | null;
  channelNames: Record<string, string>;
  enabledGames: number;
  readOnly: boolean;
}) {
  const guildId = useGuildId();
  const router = useRouter();
  const published = messageId !== null;
  const blocker = !channelId
    ? 'ESCOLHA E SALVE O CANAL DE BUSCA ABAIXO ANTES DE PUBLICAR'
    : enabledGames === 0
      ? 'LIGUE PELO MENOS UM JOGO NA ABA JOGOS ANTES DE PUBLICAR'
      : null;

  return (
    <Panel title="MENSAGEM.FIXA">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="flex flex-wrap items-center gap-2">
            <Tag tone={published ? 'success' : 'muted'}>{published ? 'NO AR' : 'NÃO PUBLICADA'}</Tag>
            {channelId ? (
              <span className="screen-meta">{channelNames[channelId] ?? channelId}</span>
            ) : null}
          </span>
          <p className="text-sm">
            Um botão por jogo ligado abre o perfil. Depois de mexer nos jogos, atualize a mensagem.
          </p>
        </div>
        {readOnly ? null : (
          <ActionButton
            label={published ? 'ATUALIZAR' : 'PUBLICAR'}
            busyLabel="PUBLICANDO_"
            successTitle="PUBLICADO"
            disabled={blocker !== null}
            action={() => publishSquadSearchMessageAction(guildId)}
            onDone={() => router.refresh()}
          />
        )}
      </div>
      {blocker && !readOnly ? <p className="screen-meta">{blocker}</p> : null}
    </Panel>
  );
}

/**
 * As quatro faces do módulo numa página só: como ele se comporta
 * (`Configuração`), para que jogos (`Jogos`), quem já joga junto (`Squads`)
 * e quem tem perfil, com o match manual (`Jogadores`).
 */
export function SquadsTabs({
  games,
  overview,
  searchingCounts,
  players,
  blocks,
  maxSquadsPerUser,
  cooldownDays,
  searchChannelId,
  searchMessageId,
  channelNames,
  timeZone,
  readOnly,
  configSlot,
}: {
  games: SquadGameRow[];
  overview: SquadsOverviewData;
  /** `gameId → perfis procurando`. */
  searchingCounts: Record<string, number>;
  /** Só para admin; `null` para quem só lê. */
  players: SquadPlayersData | null;
  blocks: SquadBlockConfig[];
  maxSquadsPerUser: number;
  cooldownDays: number;
  searchChannelId: string | null;
  searchMessageId: string | null;
  channelNames: Record<string, string>;
  /** Fuso da guild: toda data da página sai nele. */
  timeZone: string;
  readOnly: boolean;
  /** O formulário do módulo, renderizado no servidor e passado como filho. */
  configSlot: React.ReactNode;
}) {
  const guildId = useGuildId();
  const router = useRouter();
  const [editingGame, setEditingGame] = React.useState<GameEditing | null>(null);
  const searchingByGame = React.useMemo(
    () => new Map(Object.entries(searchingCounts)),
    [searchingCounts],
  );

  const gameColumns = React.useMemo<PanelColumnDef<SquadGameRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'NOME',
        cell: ({ row }) => <span className="font-bold">{row.original.name}</span>,
      },
      {
        accessorKey: 'groupSize',
        header: 'TAMANHO',
        cell: ({ row }) => (
          <span className="flex flex-col tabular-nums">
            <span>{row.original.groupSize} JOGADORES</span>
            {row.original.partySize < row.original.groupSize ? (
              <span className="screen-meta">{row.original.partySize} POR VEZ</span>
            ) : null}
          </span>
        ),
      },
      {
        id: 'fields',
        header: 'PERGUNTAS',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.fields.length === 0 ? (
            <span className="screen-meta">SÓ A GRADE</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {row.original.fields.map((field) => (
                <Tag key={field.key} tone="muted">
                  {field.label}
                </Tag>
              ))}
            </span>
          ),
      },
      {
        id: 'searching',
        header: 'PROCURANDO',
        accessorFn: (row) => searchingByGame.get(row.id) ?? 0,
        cell: ({ row }) => (
          <span className="tabular-nums">{searchingByGame.get(row.original.id) ?? 0}</span>
        ),
      },
      {
        accessorKey: 'enabled',
        header: 'ESTADO',
        cell: ({ row }) => (
          <Tag tone={row.original.enabled ? 'success' : 'muted'}>
            {row.original.enabled ? 'LIGADO' : 'DESLIGADO'}
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
              onClick={() =>
                setEditingGame({
                  id: row.original.id,
                  game: {
                    name: row.original.name,
                    groupSize: row.original.groupSize,
                    partySize: row.original.partySize,
                    enabled: row.original.enabled,
                    fields: row.original.fields,
                  },
                })
              }
            >
              {readOnly ? 'VER' : 'EDITAR'}
            </button>
            {readOnly ? null : (
              <>
                <ActionButton
                  label="MATCH"
                  busyLabel="CRUZANDO_"
                  successTitle="MATCH"
                  disabled={!row.original.enabled}
                  action={() => runSquadMatchAction(guildId, withId('gameId', row.original.id))}
                  onDone={() => router.refresh()}
                />
                <ConfirmButton
                  action={() => deleteSquadGameAction(guildId, withId('gameId', row.original.id))}
                  successMessage={`O jogo ${row.original.name} foi removido.`}
                  onDone={() => router.refresh()}
                />
              </>
            )}
          </span>
        ),
      },
    ],
    [guildId, readOnly, router, searchingByGame],
  );

  return (
    <>
      <Tabs defaultValue="config">
        <TabsList>
          <TabsTrigger value="config">CONFIGURAÇÃO</TabsTrigger>
          <TabsTrigger value="games">JOGOS</TabsTrigger>
          <TabsTrigger value="squads">SQUADS</TabsTrigger>
          <TabsTrigger value="players">JOGADORES</TabsTrigger>
        </TabsList>

        <TabsContent value="config">
          <div className="flex flex-col gap-4">
            <SearchMessagePanel
              channelId={searchChannelId}
              messageId={searchMessageId}
              channelNames={channelNames}
              enabledGames={games.filter((game) => game.enabled).length}
              readOnly={readOnly}
            />
            {configSlot}
          </div>
        </TabsContent>

        <TabsContent value="games">
          <Panel
            title="JOGOS.LST"
            actions={
              readOnly ? null : (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setEditingGame({ game: EMPTY_GAME, id: null })}
                >
                  NOVO JOGO
                </button>
              )
            }
          >
            <DataTable
              columns={gameColumns}
              data={games}
              searchPlaceholder="BUSCAR JOGO"
              emptyDescription="Nenhum jogo cadastrado. O jogo define o tamanho do squad e as perguntas do perfil."
              emptyAction={
                readOnly ? undefined : (
                  <button
                    type="button"
                    className="btn-goodchat-outline"
                    onClick={() => setEditingGame({ game: EMPTY_GAME, id: null })}
                  >
                    CRIAR JOGO
                  </button>
                )
              }
            />
          </Panel>
        </TabsContent>

        <TabsContent value="squads">
          <SquadsTable
            squads={overview.squads}
            games={games}
            channels={overview.channels}
            channelNames={channelNames}
            timeZone={timeZone}
          />
        </TabsContent>

        <TabsContent value="players">
          <PlayersTab
            games={games}
            players={players}
            proposals={overview.openProposals}
            blocks={blocks}
            timeZone={timeZone}
            maxSquadsPerUser={maxSquadsPerUser}
            cooldownDays={cooldownDays}
          />
        </TabsContent>
      </Tabs>

      <GameSheet
        editing={editingGame}
        searchPublished={searchMessageId !== null}
        readOnly={readOnly}
        onClose={(changed) => {
          setEditingGame(null);
          if (changed) router.refresh();
        }}
      />
    </>
  );
}
