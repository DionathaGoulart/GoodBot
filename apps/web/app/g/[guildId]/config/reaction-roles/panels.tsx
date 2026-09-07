'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import {
  deletePanelAction,
  publishPanelAction,
} from '@/app/actions/modules';
import { ActionButton, ConfirmButton } from '@/components/config/confirm-button';
import { DataTable, type PanelColumnDef } from '@/components/data-table';
import { Panel } from '@/components/retro/panel';
import { Tag } from '@/components/retro/tag';

import { EMPTY_PANEL, PanelSheet, type PanelEditing } from './panel-sheet';

import type { PanelRow } from '@/lib/reaction-roles';

export function PanelsTable({
  panels,
  channelNames,
  embedColor,
  readOnly,
}: {
  panels: PanelRow[];
  /** ID → `#nome`; vem do bot no server component. */
  channelNames: Record<string, string>;
  embedColor: number;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<PanelEditing | null>(null);

  const withPanelId = (id: string) => {
    const formData = new FormData();
    formData.set('panelId', id);
    return formData;
  };

  const columns = React.useMemo<PanelColumnDef<PanelRow>[]>(
    () => [
      {
        accessorKey: 'channelId',
        header: 'CANAL',
        cell: ({ row }) => (
          <span className="font-bold">
            {channelNames[row.original.channelId] ?? `#${row.original.channelId}`}
          </span>
        ),
      },
      {
        accessorKey: 'style',
        header: 'ESTILO',
        cell: ({ row }) => <Tag>{row.original.style}</Tag>,
      },
      {
        accessorKey: 'mode',
        header: 'MODO',
        cell: ({ row }) => <Tag tone="muted">{row.original.mode}</Tag>,
      },
      {
        id: 'items',
        header: 'CARGOS',
        enableSorting: false,
        cell: ({ row }) => <span className="tabular-nums">{row.original.items.length}</span>,
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
                setEditing({
                  id: row.original.id,
                  panel: {
                    channelId: row.original.channelId,
                    mode: row.original.mode,
                    style: row.original.style,
                    content: row.original.content,
                    items: row.original.items,
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
                  action={() => publishPanelAction(withPanelId(row.original.id))}
                  onDone={() => router.refresh()}
                />
                <ConfirmButton
                  label="REMOVER"
                  action={() => deletePanelAction(withPanelId(row.original.id))}
                  successMessage="O painel e a mensagem saíram do ar."
                  onDone={() => router.refresh()}
                />
              </>
            )}
          </span>
        ),
      },
    ],
    [channelNames, readOnly, router],
  );

  return (
    <Panel
      title="PAINEIS.LST"
      actions={
        readOnly ? null : (
          <button
            type="button"
            className="icon-btn"
            onClick={() => setEditing({ panel: EMPTY_PANEL, id: null })}
          >
            NOVO PAINEL
          </button>
        )
      }
    >
      <DataTable
        columns={columns}
        data={panels}
        searchPlaceholder="BUSCAR PAINEL"
        emptyDescription="Nenhum painel criado. Um painel é uma mensagem com botões que dão cargos."
        emptyAction={
          readOnly ? undefined : (
            <button
              type="button"
              className="btn-goodchat-outline"
              onClick={() => setEditing({ panel: EMPTY_PANEL, id: null })}
            >
              CRIAR PAINEL
            </button>
          )
        }
      />

      <PanelSheet
        editing={editing}
        embedColor={embedColor}
        readOnly={readOnly}
        onClose={(changed) => {
          setEditing(null);
          if (changed) router.refresh();
        }}
      />
    </Panel>
  );
}
