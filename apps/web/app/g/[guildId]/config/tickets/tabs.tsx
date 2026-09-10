'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import {
  closeTicketFormAction,
  deleteTicketPanelAction,
  deleteTicketTypeAction,
  publishTicketPanelAction,
} from '@/app/actions/modules';
import { ActionButton, ConfirmButton } from '@/components/config/confirm-button';
import { DataTable, type PanelColumnDef } from '@/components/data-table';
import { Panel } from '@/components/retro/panel';
import { Tag } from '@/components/retro/tag';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { EMPTY_TICKET_PANEL, TicketPanelSheet, type TicketPanelEditing } from './panel-sheet';
import { EMPTY_TYPE, TypeSheet, type TypeEditing } from './type-sheet';

import type { TicketPanelRow, TicketRow, TicketTypeRow } from '@/lib/tickets';

function withId(key: string, value: string): FormData {
  const formData = new FormData();
  formData.set(key, value);
  return formData;
}

/**
 * §6.2 — as quatro faces do módulo numa página só: o que se pode abrir
 * (`Tipos`), por onde se abre (`Painel`), como se comporta (`Configuração`, no
 * formulário abaixo) e o que está aberto agora (`Tickets`).
 */
export function TicketsTabs({
  types,
  panels,
  tickets,
  channelNames,
  roleNames,
  embedColor,
  readOnly,
  configSlot,
}: {
  types: TicketTypeRow[];
  panels: TicketPanelRow[];
  tickets: TicketRow[];
  channelNames: Record<string, string>;
  roleNames: Record<string, string>;
  embedColor: number;
  readOnly: boolean;
  /** O formulário do módulo, renderizado no servidor e passado como filho. */
  configSlot: React.ReactNode;
}) {
  const router = useRouter();
  const [editingType, setEditingType] = React.useState<TypeEditing | null>(null);
  const [editingPanel, setEditingPanel] = React.useState<TicketPanelEditing | null>(null);
  const typeName = React.useMemo(() => new Map(types.map((type) => [type.id, type.name])), [types]);

  const typeColumns = React.useMemo<PanelColumnDef<TicketTypeRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'NOME',
        cell: ({ row }) => <span className="font-bold">{row.original.name}</span>,
      },
      {
        accessorKey: 'categoryId',
        header: 'CATEGORIA',
        cell: ({ row }) => (
          <span className="screen-meta">
            {channelNames[row.original.categoryId] ?? row.original.categoryId}
          </span>
        ),
      },
      {
        id: 'support',
        header: 'SUPORTE',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.supportRoleIds.length === 0 ? (
            <span className="screen-meta">SÓ A MODERAÇÃO</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {row.original.supportRoleIds.map((roleId) => (
                <Tag key={roleId} tone="muted">
                  {roleNames[roleId] ?? roleId}
                </Tag>
              ))}
            </span>
          ),
      },
      {
        id: 'controls',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex justify-end gap-2">
            <button
              type="button"
              className="icon-btn"
              onClick={() =>
                setEditingType({
                  id: row.original.id,
                  type: {
                    name: row.original.name,
                    categoryId: row.original.categoryId,
                    supportRoleIds: row.original.supportRoleIds,
                    openingMessage: row.original.openingMessage,
                    maxOpenPerUser: row.original.maxOpenPerUser,
                    namingPattern: row.original.namingPattern,
                  },
                })
              }
            >
              {readOnly ? 'VER' : 'EDITAR'}
            </button>
            {readOnly ? null : (
              <ConfirmButton
                action={() => deleteTicketTypeAction(withId('typeId', row.original.id))}
                successMessage={`O tipo ${row.original.name} foi removido.`}
                onDone={() => router.refresh()}
              />
            )}
          </span>
        ),
      },
    ],
    [channelNames, readOnly, roleNames, router],
  );

  const panelColumns = React.useMemo<PanelColumnDef<TicketPanelRow>[]>(
    () => [
      {
        accessorKey: 'channelId',
        header: 'CANAL',
        cell: ({ row }) => (
          <span className="font-bold">
            {channelNames[row.original.channelId] ?? row.original.channelId}
          </span>
        ),
      },
      {
        id: 'types',
        header: 'TIPOS',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            {row.original.typeIds.map((id) => (
              <Tag key={id} tone="muted">
                {typeName.get(id) ?? 'TIPO REMOVIDO'}
              </Tag>
            ))}
          </span>
        ),
      },
      {
        accessorKey: 'messageId',
        header: 'ESTADO',
        cell: ({ row }) => (
          <Tag tone={row.original.messageId ? 'success' : 'muted'}>
            {row.original.messageId ? 'PUBLICADO' : 'RASCUNHO'}
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
                setEditingPanel({
                  id: row.original.id,
                  panel: {
                    channelId: row.original.channelId,
                    content: row.original.content,
                    typeIds: row.original.typeIds,
                  },
                })
              }
            >
              {readOnly ? 'VER' : 'EDITAR'}
            </button>
            {readOnly ? null : (
              <>
                <ActionButton
                  label={row.original.messageId ? 'ATUALIZAR' : 'PUBLICAR'}
                  busyLabel="PUBLICANDO_"
                  successTitle="PUBLICADO"
                  action={() => publishTicketPanelAction(withId('panelId', row.original.id))}
                  onDone={() => router.refresh()}
                />
                <ConfirmButton
                  label="REMOVER"
                  action={() => deleteTicketPanelAction(withId('panelId', row.original.id))}
                  onDone={() => router.refresh()}
                />
              </>
            )}
          </span>
        ),
      },
    ],
    [channelNames, readOnly, router, typeName],
  );

  const ticketColumns = React.useMemo<PanelColumnDef<TicketRow>[]>(
    () => [
      {
        accessorKey: 'number',
        header: '#',
        cell: ({ row }) => <span className="tabular-nums font-bold">#{row.original.number}</span>,
      },
      {
        accessorKey: 'userId',
        header: 'AUTOR',
        cell: ({ row }) => <span className="screen-meta select-all">{row.original.userId}</span>,
      },
      {
        id: 'type',
        header: 'TIPO',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="screen-meta">
            {row.original.typeId ? (typeName.get(row.original.typeId) ?? '—') : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'ESTADO',
        cell: ({ row }) => (
          <Tag tone={row.original.status === 'open' ? 'success' : 'muted'}>
            {row.original.status === 'open' ? 'ABERTO' : 'FECHADO'}
          </Tag>
        ),
      },
      {
        accessorKey: 'openedAt',
        header: 'ABERTO EM',
        cell: ({ row }) => (
          <time
            className="screen-meta"
            dateTime={row.original.openedAt}
            title={row.original.openedAt}
          >
            {new Date(row.original.openedAt).toLocaleDateString('pt-BR')}
          </time>
        ),
      },
      {
        id: 'controls',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex justify-end gap-2">
            {row.original.transcriptUrl ? (
              <a
                className="icon-btn"
                href={row.original.transcriptUrl}
                target="_blank"
                rel="noreferrer"
              >
                TRANSCRIPT
              </a>
            ) : null}
            {row.original.status === 'open' ? (
              <ConfirmButton
                label="FECHAR"
                successTitle="FECHADO"
                action={() => closeTicketFormAction(withId('ticketId', String(row.original.id)))}
                onDone={() => router.refresh()}
              />
            ) : null}
          </span>
        ),
      },
    ],
    [router, typeName],
  );

  return (
    <>
      <Tabs defaultValue="types">
        <TabsList>
          <TabsTrigger value="types">TIPOS</TabsTrigger>
          <TabsTrigger value="panel">PAINEL</TabsTrigger>
          <TabsTrigger value="config">CONFIGURAÇÃO</TabsTrigger>
          <TabsTrigger value="tickets">TICKETS</TabsTrigger>
        </TabsList>

        <TabsContent value="types">
          <Panel
            title="TIPOS.LST"
            actions={
              readOnly ? null : (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setEditingType({ type: EMPTY_TYPE, id: null })}
                >
                  NOVO TIPO
                </button>
              )
            }
          >
            <DataTable
              columns={typeColumns}
              data={types}
              searchPlaceholder="BUSCAR TIPO"
              emptyDescription="Nenhum tipo cadastrado. O tipo define a categoria e a equipe do ticket."
              emptyAction={
                readOnly ? undefined : (
                  <button
                    type="button"
                    className="btn-goodchat-outline"
                    onClick={() => setEditingType({ type: EMPTY_TYPE, id: null })}
                  >
                    CRIAR TIPO
                  </button>
                )
              }
            />
          </Panel>
        </TabsContent>

        <TabsContent value="panel">
          <Panel
            title="PAINEL.LST"
            actions={
              readOnly ? null : (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setEditingPanel({ panel: EMPTY_TICKET_PANEL, id: null })}
                >
                  NOVO PAINEL
                </button>
              )
            }
          >
            <DataTable
              columns={panelColumns}
              data={panels}
              emptyDescription="Nenhum painel. É a mensagem com os botões que abrem ticket."
              emptyAction={
                readOnly ? undefined : (
                  <button
                    type="button"
                    className="btn-goodchat-outline"
                    onClick={() => setEditingPanel({ panel: EMPTY_TICKET_PANEL, id: null })}
                  >
                    CRIAR PAINEL
                  </button>
                )
              }
            />
          </Panel>
        </TabsContent>

        <TabsContent value="config">{configSlot}</TabsContent>

        <TabsContent value="tickets">
          <Panel title="TICKETS.LOG">
            <DataTable
              columns={ticketColumns}
              data={tickets}
              searchPlaceholder="BUSCAR TICKET"
              emptyDescription="Nenhum ticket ainda. Eles aparecem aqui assim que alguém abrir o primeiro."
            />
          </Panel>
        </TabsContent>
      </Tabs>

      <TypeSheet
        editing={editingType}
        embedColor={embedColor}
        readOnly={readOnly}
        onClose={(changed) => {
          setEditingType(null);
          if (changed) router.refresh();
        }}
      />
      <TicketPanelSheet
        editing={editingPanel}
        types={types}
        embedColor={embedColor}
        readOnly={readOnly}
        onClose={(changed) => {
          setEditingPanel(null);
          if (changed) router.refresh();
        }}
      />
    </>
  );
}
