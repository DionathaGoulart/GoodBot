'use client';

import * as React from 'react';
import { SOCIAL_KIND_LABEL, SOCIAL_MAX_FAILURES } from '@goodbot/shared';
import { useRouter } from 'next/navigation';

import { deleteSocialAccountAction, testSocialAccountAction } from '@/app/actions/social';
import { ActionButton, ConfirmButton } from '@/components/config/confirm-button';
import { DataTable, type PanelColumnDef } from '@/components/data-table';
import { AvatarSq } from '@/components/retro/avatar-sq';
import { Panel } from '@/components/retro/panel';
import { Tag } from '@/components/retro/tag';
import { useGuildId } from '@/lib/use-guild-id';

import { AccountSheet, EMPTY_ACCOUNT, type AccountEditing } from './account-sheet';

import type { SocialAccountSummary } from '@goodbot/shared';

const MINUTE_MS = 60_000;

/** "há 2 min" a partir do ISO da última passada; o ISO cheio fica no `title`. */
export function sinceLabel(iso: string, now: number): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / MINUTE_MS);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${String(hours)} h`;
  return `há ${String(Math.floor(hours / 24))} d`;
}

function subscribeMinute(onChange: () => void): () => void {
  const timer = setInterval(onChange, MINUTE_MS);
  return () => clearInterval(timer);
}

/**
 * Estado da conta em uma linha (§6.3). O relógio só existe depois da
 * hidratação — `0` no servidor, como no indicador de auto-refresh — para o HTML
 * do servidor não discordar do primeiro render do cliente.
 */
function AccountState({ account }: { account: SocialAccountSummary }) {
  const now = React.useSyncExternalStore(
    subscribeMinute,
    () => Date.now(),
    () => 0,
  );

  if (!account.enabled) {
    return (
      <span className="flex flex-col gap-1">
        {/* O motivo só existe quando foi o bot que desligou (10 falhas). */}
        <Tag tone="muted">{account.disabledReason ? 'DESATIVADA' : 'DESLIGADA'}</Tag>
        {account.disabledReason ? (
          <span className="screen-meta">{account.disabledReason}</span>
        ) : null}
      </span>
    );
  }

  if (account.failureCount > 0) {
    return (
      <span className="flex flex-col gap-1">
        <Tag tone="warning">
          FALHANDO · {account.failureCount}/{SOCIAL_MAX_FAILURES}
        </Tag>
        <span className="screen-meta">erros seguidos ao falar com o YouTube</span>
      </span>
    );
  }

  return (
    <span className="flex flex-col gap-1">
      <Tag tone="success">OK</Tag>
      {account.lastCheckedAt ? (
        <time
          dateTime={account.lastCheckedAt}
          title={account.lastCheckedAt}
          className="screen-meta"
        >
          {now > 0 ? sinceLabel(account.lastCheckedAt, now) : '—'}
        </time>
      ) : (
        <span className="screen-meta">ainda não checada</span>
      )}
    </span>
  );
}

export function AccountsTable({
  accounts,
  channelNames,
  embedColor,
  readOnly,
}: {
  accounts: SocialAccountSummary[];
  /** ID → `#nome`; vem do bot no server component. */
  channelNames: Record<string, string>;
  embedColor: number;
  readOnly: boolean;
}) {
  const guildId = useGuildId();
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
        accessorKey: 'externalId',
        header: 'CANAL',
        cell: ({ row }) => {
          const name = row.original.displayName ?? row.original.handle ?? row.original.externalId;
          return (
            <span className="flex items-center gap-2">
              <AvatarSq src={row.original.avatarUrl} name={name} size={24} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-bold">{name}</span>
                <span className="screen-meta truncate">
                  {row.original.handle ?? row.original.externalId}
                </span>
              </span>
            </span>
          );
        },
      },
      {
        accessorKey: 'discordChannelId',
        header: 'DESTINO',
        cell: ({ row }) =>
          channelNames[row.original.discordChannelId] ?? `#${row.original.discordChannelId}`,
      },
      {
        id: 'kinds',
        header: 'ANUNCIA',
        enableSorting: false,
        cell: ({ row }) => row.original.kinds.map((kind) => SOCIAL_KIND_LABEL[kind]).join(', '),
      },
      {
        accessorKey: 'enabled',
        header: 'ESTADO',
        cell: ({ row }) => <AccountState account={row.original} />,
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
                    avatarUrl: row.original.avatarUrl,
                    discordChannelId: row.original.discordChannelId,
                    kinds: row.original.kinds,
                    template: row.original.template,
                    mentionRoleId: row.original.mentionRoleId,
                    enabled: row.original.enabled,
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
                  action={() => testSocialAccountAction(guildId, withAccountId(row.original.id))}
                />
                <ConfirmButton
                  label="REMOVER"
                  action={() => deleteSocialAccountAction(guildId, withAccountId(row.original.id))}
                  successMessage="O bot parou de observar esse canal."
                  onDone={() => router.refresh()}
                />
              </>
            )}
          </span>
        ),
      },
    ],
    [guildId, channelNames, readOnly, router],
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
            NOVO CANAL
          </button>
        )
      }
    >
      <DataTable
        columns={columns}
        data={accounts}
        searchPlaceholder="BUSCAR CANAL"
        emptyDescription="Nenhum canal observado. Cole a URL de um canal do YouTube e o bot avisa aqui no Discord quando ele publicar."
        emptyAction={
          readOnly ? undefined : (
            <button
              type="button"
              className="btn-goodchat-outline"
              onClick={() => setEditing({ account: EMPTY_ACCOUNT, id: null })}
            >
              ADICIONAR CANAL
            </button>
          )
        }
      />

      <AccountSheet
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
