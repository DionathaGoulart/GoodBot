'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { deleteSocialAccountAction, testSocialAccountAction } from '@/app/actions/social';
import { ActionButton, ConfirmButton } from '@/components/config/confirm-button';
import { DataTable, type PanelColumnDef } from '@/components/data-table';
import { Panel } from '@/components/retro/panel';
import { Tag } from '@/components/retro/tag';

import { AccountSheet, EMPTY_ACCOUNT, type AccountEditing } from './account-sheet';
import { KIND_LABEL, PLATFORM_LABEL } from './labels';

import type { SocialAccountSummary, SocialPlatformStatus } from '@cobot/shared';

export function AccountsTable({
  accounts,
  platforms,
  channelNames,
  embedColor,
  readOnly,
}: {
  accounts: SocialAccountSummary[];
  platforms: SocialPlatformStatus[];
  /** ID → `#nome`; vem do bot no server component. */
  channelNames: Record<string, string>;
  embedColor: number;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<AccountEditing | null>(null);

  const withAccountId = (id: string) => {
    const formData = new FormData();
    formData.set('accountId', id);
    return formData;
  };

  const columns = React.useMemo<PanelColumnDef<SocialAccountSummary>[]>(
    () => [
      {
        accessorKey: 'platform',
        header: 'REDE',
        cell: ({ row }) => <Tag>{PLATFORM_LABEL[row.original.platform]}</Tag>,
      },
      {
        accessorKey: 'externalId',
        header: 'CONTA',
        cell: ({ row }) => (
          <span className="font-bold">
            {row.original.displayName ?? row.original.handle ?? row.original.externalId}
          </span>
        ),
      },
      {
        accessorKey: 'discordChannelId',
        header: 'CANAL',
        cell: ({ row }) =>
          channelNames[row.original.discordChannelId] ?? `#${row.original.discordChannelId}`,
      },
      {
        id: 'kinds',
        header: 'ANUNCIA',
        enableSorting: false,
        cell: ({ row }) => row.original.kinds.map((kind) => KIND_LABEL[kind]).join(', '),
      },
      {
        accessorKey: 'enabled',
        header: 'ESTADO',
        cell: ({ row }) =>
          row.original.enabled ? (
            <Tag tone="success">LIGADA</Tag>
          ) : (
            // O motivo só existe quando foi o bot que desligou (10 falhas).
            <span className="flex flex-col gap-1">
              <Tag tone="muted">{row.original.disabledReason ? 'DESATIVADA' : 'DESLIGADA'}</Tag>
              {row.original.disabledReason ? (
                <span className="screen-meta">{row.original.disabledReason}</span>
              ) : null}
            </span>
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
                  account: {
                    platform: row.original.platform,
                    externalId: row.original.externalId,
                    handle: row.original.handle,
                    displayName: row.original.displayName,
                    discordChannelId: row.original.discordChannelId,
                    kinds: row.original.kinds,
                    template: row.original.template,
                    mentionRoleId: row.original.mentionRoleId,
                    enabled: row.original.enabled,
                    pollIntervalSeconds: row.original.pollIntervalSeconds,
                  },
                })
              }
            >
              {readOnly ? 'VER' : 'EDITAR'}
            </button>
            {readOnly ? null : (
              <>
                <ActionButton
                  label="TESTAR"
                  busyLabel="ENVIANDO_"
                  successTitle="ENVIADO"
                  action={() => testSocialAccountAction(withAccountId(row.original.id))}
                />
                <ConfirmButton
                  label="REMOVER"
                  action={() => deleteSocialAccountAction(withAccountId(row.original.id))}
                  successMessage="O bot parou de observar essa conta."
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
      title="CONTAS.LST"
      actions={
        readOnly ? null : (
          <button
            type="button"
            className="icon-btn"
            onClick={() => setEditing({ account: EMPTY_ACCOUNT, id: null })}
          >
            NOVA CONTA
          </button>
        )
      }
    >
      <DataTable
        columns={columns}
        data={accounts}
        searchPlaceholder="BUSCAR CONTA"
        emptyDescription="Nenhuma conta observada. Cada conta vira um aviso no canal quando ela publicar."
        emptyAction={
          readOnly ? undefined : (
            <button
              type="button"
              className="btn-goodchat-outline"
              onClick={() => setEditing({ account: EMPTY_ACCOUNT, id: null })}
            >
              ADICIONAR CONTA
            </button>
          )
        }
      />

      <AccountSheet
        editing={editing}
        platforms={platforms}
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
