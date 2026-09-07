'use client';

import * as React from 'react';
import { bitfieldToPermissions, hasDangerousPermissions } from '@cobot/shared';
import { useRouter } from 'next/navigation';

import { deleteRoleAction, moveRoleAction } from '@/app/actions/guild';
import { ActionButton, ConfirmButton } from '@/components/config/confirm-button';
import { colorToHex } from '@/components/config/discord-options';
import { DataTable, type PanelColumnDef } from '@/components/data-table';
import { Panel } from '@/components/retro/panel';
import { Tag } from '@/components/retro/tag';

import { EMPTY_ROLE, RoleSheet, type RoleEditing } from './role-sheet';

import type { GuildRoleSummary } from '@cobot/shared';

type RoleRow = GuildRoleSummary & Record<string, unknown>;

function withRoleId(id: string, extra: Record<string, string> = {}): FormData {
  const formData = new FormData();
  formData.set('roleId', id);
  for (const [key, value] of Object.entries(extra)) formData.set(key, value);
  return formData;
}

export function RolesTable({
  roles,
  readOnly,
}: {
  roles: GuildRoleSummary[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<RoleEditing | null>(null);
  const rows = roles as RoleRow[];

  const columns = React.useMemo<PanelColumnDef<RoleRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'CARGO',
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-4 shrink-0 border-2 border-base-300"
              style={{ background: row.original.color === 0 ? 'transparent' : colorToHex(row.original.color) }}
            />
            <span className="font-bold">{row.original.name}</span>
          </span>
        ),
      },
      {
        id: 'flags',
        header: 'ALERTAS',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1.5">
            {hasDangerousPermissions(row.original.permissions) ? (
              <Tag tone="error">PERIGOSO</Tag>
            ) : null}
            {row.original.managed ? <Tag tone="muted">INTEGRAÇÃO</Tag> : null}
          </span>
        ),
      },
      {
        accessorKey: 'memberCount',
        header: 'MEMBROS',
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.memberCount ?? 0}</span>
        ),
      },
      {
        accessorKey: 'position',
        header: 'POSIÇÃO',
        cell: ({ row }) => <span className="tabular-nums">{row.original.position}</span>,
      },
      {
        id: 'controls',
        header: '',
        enableSorting: false,
        cell: ({ row }) => {
          const role = row.original;
          return (
            <span className="flex flex-wrap justify-end gap-2">
              {readOnly || role.managed ? null : (
                <>
                  <ActionButton
                    label="▲"
                    busyLabel="_"
                    successTitle="MOVIDO"
                    action={() => moveRoleAction(withRoleId(role.id, { direction: 'up' }))}
                    onDone={() => router.refresh()}
                  />
                  <ActionButton
                    label="▼"
                    busyLabel="_"
                    successTitle="MOVIDO"
                    action={() => moveRoleAction(withRoleId(role.id, { direction: 'down' }))}
                    onDone={() => router.refresh()}
                  />
                </>
              )}
              <button
                type="button"
                className="icon-btn"
                onClick={() =>
                  setEditing({
                    id: role.id,
                    role: {
                      name: role.name,
                      color: role.color,
                      hoist: role.hoist,
                      mentionable: role.mentionable,
                      permissions: bitfieldToPermissions(role.permissions),
                    },
                  })
                }
              >
                {readOnly || role.managed ? 'VER' : 'EDITAR'}
              </button>
              {readOnly || role.managed ? null : (
                <ConfirmButton
                  label="REMOVER"
                  action={() => deleteRoleAction(withRoleId(role.id))}
                  successMessage="O cargo saiu do servidor."
                  onDone={() => router.refresh()}
                />
              )}
            </span>
          );
        },
      },
    ],
    [readOnly, router],
  );

  return (
    <Panel
      title="CARGOS.LST"
      actions={
        readOnly ? null : (
          <button
            type="button"
            className="icon-btn"
            onClick={() => setEditing({ id: null, role: EMPTY_ROLE })}
          >
            NOVO CARGO
          </button>
        )
      }
    >
      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="BUSCAR CARGO"
        emptyDescription="Nenhum cargo gerenciável. Cargos acima do cargo do bot não aparecem aqui."
      />

      <RoleSheet
        editing={editing}
        readOnly={readOnly}
        onClose={(changed) => {
          setEditing(null);
          if (changed) router.refresh();
        }}
      />
    </Panel>
  );
}
