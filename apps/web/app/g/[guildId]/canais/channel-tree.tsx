'use client';

import * as React from 'react';
import { MANAGED_CHANNEL_TYPES } from '@cobot/shared';
import { useRouter } from 'next/navigation';

import { deleteChannelAction, toggleChannelLockAction } from '@/app/actions/guild';
import { ActionButton, ConfirmButton } from '@/components/config/confirm-button';
import { Panel } from '@/components/retro/panel';
import { EmptyState } from '@/components/retro/states';
import { Tag } from '@/components/retro/tag';

import { ChannelSheet, type ChannelEditing } from './channel-sheet';

import type { ChannelBranch } from '@/lib/channels';
import type { GuildChannelSummary } from '@cobot/shared';

/** O prefixo que o Discord mostra na frente do nome de cada tipo de canal. */
const PREFIX: Record<number, string> = {
  [MANAGED_CHANNEL_TYPES.text]: '#',
  [MANAGED_CHANNEL_TYPES.announcement]: '📢',
  [MANAGED_CHANNEL_TYPES.voice]: '🔊',
};

/** Trancar só faz sentido onde se escreve; num canal de voz não há o que trancar. */
function isTextual(type: number): boolean {
  return type === MANAGED_CHANNEL_TYPES.text || type === MANAGED_CHANNEL_TYPES.announcement;
}

function withChannelId(id: string, extra: Record<string, string> = {}): FormData {
  const formData = new FormData();
  formData.set('channelId', id);
  for (const [key, value] of Object.entries(extra)) formData.set(key, value);
  return formData;
}

function ChannelRow({
  channel,
  readOnly,
  onEdit,
  onDone,
}: {
  channel: GuildChannelSummary;
  readOnly: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 border-b-2 border-base-300/30 py-2">
      <span className="font-bold">
        {PREFIX[channel.type] ?? '#'} {channel.name}
      </span>
      <span className="screen-meta select-all">{channel.id}</span>
      <span className="ml-auto flex flex-wrap gap-2">
        <button type="button" className="icon-btn" onClick={onEdit}>
          {readOnly ? 'VER' : 'EDITAR'}
        </button>
        {readOnly ? null : (
          <>
            {isTextual(channel.type) ? (
              <>
                <ActionButton
                  label="TRANCAR"
                  busyLabel="TRANCANDO_"
                  successTitle="TRANCADO"
                  action={() => toggleChannelLockAction(withChannelId(channel.id, { lock: 'true' }))}
                  onDone={onDone}
                />
                <ActionButton
                  label="DESTRANCAR"
                  busyLabel="ABRINDO_"
                  successTitle="DESTRANCADO"
                  action={() =>
                    toggleChannelLockAction(withChannelId(channel.id, { lock: 'false' }))
                  }
                  onDone={onDone}
                />
              </>
            ) : null}
            <ConfirmButton
              label="APAGAR"
              action={() => deleteChannelAction(withChannelId(channel.id))}
              successMessage="O canal saiu do servidor."
              onDone={onDone}
            />
          </>
        )}
      </span>
    </li>
  );
}

/**
 * §6.3 — a árvore de canais. Lista aninhada, sem drag: o painel não reordena
 * canais, só cria, edita e apaga.
 */
export function ChannelTree({
  tree,
  roleNames,
  readOnly,
}: {
  tree: ChannelBranch[];
  roleNames: Record<string, string>;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<ChannelEditing | null>(null);
  const refresh = () => router.refresh();

  const categories = React.useMemo(
    () =>
      tree
        .filter((branch) => branch.id !== null)
        .map((branch) => ({ id: branch.id as string, name: branch.name })),
    [tree],
  );

  return (
    <Panel
      title="CANAIS.TREE"
      actions={
        readOnly ? null : (
          <>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setEditing({ id: null, type: MANAGED_CHANNEL_TYPES.text })}
            >
              NOVO CANAL
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setEditing({ id: null, type: MANAGED_CHANNEL_TYPES.category })}
            >
              NOVA CATEGORIA
            </button>
          </>
        )
      }
    >
      {tree.length === 0 ? (
        <EmptyState description="Nenhum canal visível para o bot neste servidor." />
      ) : (
        tree.map((branch) => (
          <section key={branch.id ?? 'sem-categoria'} className="flex flex-col gap-1">
            <header className="flex flex-wrap items-center gap-2 border-b-2 border-base-300 pb-2">
              <span className="screen-kicker">{branch.name}</span>
              <Tag tone="muted">{branch.children.length}</Tag>
              {branch.id && !readOnly ? (
                <span className="ml-auto flex gap-2">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() =>
                      setEditing({ id: branch.id, type: MANAGED_CHANNEL_TYPES.category })
                    }
                  >
                    EDITAR
                  </button>
                  <ConfirmButton
                    label="APAGAR"
                    action={() => deleteChannelAction(withChannelId(branch.id as string))}
                    successMessage="A categoria saiu do servidor."
                    onDone={refresh}
                  />
                </span>
              ) : null}
            </header>
            <ul className="flex flex-col">
              {branch.children.map((channel) => (
                <ChannelRow
                  key={channel.id}
                  channel={channel}
                  readOnly={readOnly}
                  onEdit={() => setEditing({ id: channel.id, type: channel.type })}
                  onDone={refresh}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      <ChannelSheet
        editing={editing}
        categories={categories}
        roleNames={roleNames}
        readOnly={readOnly}
        onClose={(changed) => {
          setEditing(null);
          if (changed) refresh();
        }}
      />
    </Panel>
  );
}
