'use client';

import * as React from 'react';
import {
  INVITE_MAX_AGES,
  INVITE_MAX_AGE_LABEL,
  INVITE_MAX_USES_LABEL,
  INVITE_MAX_USES_OPTIONS,
} from '@cobot/shared';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { createInviteAction, deleteInviteAction } from '@/app/actions/guild';
import { DiscordPicker } from '@/components/config/discord-picker';
import { DataTable, type PanelColumnDef } from '@/components/data-table';
import { AvatarSq } from '@/components/retro/avatar-sq';
import { Panel } from '@/components/retro/panel';
import { Tag } from '@/components/retro/tag';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { GuildInviteList, GuildInviteSummary } from '@cobot/shared';

type InviteRow = GuildInviteSummary & Record<string, unknown>;

/** Canais em que faz sentido cair ao aceitar um convite. */
const INVITE_CHANNEL_TYPES = [0, 2, 5, 13, 15];

function UsesCell({ invite }: { invite: GuildInviteSummary }) {
  const label = invite.maxUses === 0 ? '∞' : String(invite.maxUses);
  return (
    <span className="tabular-nums text-sm">
      {String(invite.uses)} / {label}
    </span>
  );
}

/**
 * Só a data: o Discord já não devolve convite vencido, então comparar com o
 * relógio aqui seria um `Date.now()` no meio do render para responder uma
 * pergunta que a lista nunca faz.
 */
function ExpiryCell({ invite }: { invite: GuildInviteSummary }) {
  if (!invite.expiresAt) return <Tag tone="muted">NUNCA</Tag>;
  return (
    <time dateTime={invite.expiresAt} className="screen-meta">
      {new Date(invite.expiresAt).toLocaleString('pt-BR')}
    </time>
  );
}

export function InvitesScreen({
  list,
  readOnly,
}: {
  list: GuildInviteList;
  readOnly: boolean;
}) {
  const router = useRouter();

  const [channelId, setChannelId] = React.useState<string[]>([]);
  const [maxAge, setMaxAge] = React.useState(86_400);
  const [maxUses, setMaxUses] = React.useState(0);
  const [temporary, setTemporary] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [target, setTarget] = React.useState<GuildInviteSummary | null>(null);

  const locked = readOnly || !list.canManage;

  async function create() {
    const channel = channelId[0];
    if (!channel) return;
    setBusy(true);
    try {
      const formData = new FormData();
      formData.set(
        'invite',
        JSON.stringify({ channelId: channel, maxAge, maxUses, temporary, unique: true }),
      );
      const result = await createInviteAction(formData);
      if (!result.ok) {
        toast.error('ERRO', { description: result.message });
        return;
      }
      toast.success('CRIADO', { description: result.message });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!target) return;
    setBusy(true);
    try {
      const formData = new FormData();
      formData.set('code', target.code);
      const result = await deleteInviteAction(formData);
      if (!result.ok) {
        toast.error('ERRO', { description: result.message });
        return;
      }
      toast.success('REVOGADO', { description: result.message });
      setTarget(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const columns = React.useMemo<PanelColumnDef<InviteRow>[]>(
    () => [
      {
        id: 'code',
        header: 'CÓDIGO',
        cell: ({ row }) => (
          <a
            href={row.original.url}
            target="_blank"
            rel="noreferrer noopener"
            className="font-bold underline decoration-accent decoration-2 underline-offset-4"
          >
            {row.original.code}
          </a>
        ),
      },
      {
        id: 'channel',
        header: 'CANAL',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.channel ? `#${row.original.channel.name}` : '—'}
          </span>
        ),
      },
      {
        id: 'inviter',
        header: 'POR',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.inviter ? (
            <span className="flex items-center gap-2">
              <AvatarSq
                src={row.original.inviter.avatarUrl}
                name={row.original.inviter.username}
                size={20}
              />
              <span className="text-sm">{row.original.inviter.username}</span>
            </span>
          ) : (
            <span className="screen-meta">—</span>
          ),
      },
      { id: 'uses', header: 'USOS', cell: ({ row }) => <UsesCell invite={row.original} /> },
      {
        id: 'expiresAt',
        header: 'EXPIRA',
        cell: ({ row }) => <ExpiryCell invite={row.original} />,
      },
      {
        id: 'flags',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (row.original.temporary ? <Tag tone="warning">TEMPORÁRIO</Tag> : null),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) =>
          locked ? null : (
            <button type="button" className="icon-btn" onClick={() => setTarget(row.original)}>
              REVOGAR
            </button>
          ),
      },
    ],
    [locked],
  );

  return (
    <div className="flex flex-col gap-4">
      {list.canManage ? null : (
        <p className="border-2 border-warning p-3 text-xs text-warning-text">
          ! O bot não tem a permissão Gerenciar Servidor, então não consegue listar nem revogar
          convites. Reconvide-o com ela.
        </p>
      )}

      {locked ? null : (
        <Panel title="NOVO.INV">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-channel">Canal de destino</Label>
              <DiscordPicker
                id="invite-channel"
                kind="channel"
                channelTypes={INVITE_CHANNEL_TYPES}
                value={channelId}
                onChange={setChannelId}
                disabled={busy}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-age">Validade</Label>
              <Select
                value={String(maxAge)}
                disabled={busy}
                onValueChange={(value) => setMaxAge(Number(value))}
              >
                <SelectTrigger id="invite-age" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVITE_MAX_AGES.map((seconds) => (
                    <SelectItem key={seconds} value={String(seconds)}>
                      {INVITE_MAX_AGE_LABEL[seconds] ?? `${String(seconds)}s`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-uses">Número de usos</Label>
              <Select
                value={String(maxUses)}
                disabled={busy}
                onValueChange={(value) => setMaxUses(Number(value))}
              >
                <SelectTrigger id="invite-uses" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVITE_MAX_USES_OPTIONS.map((uses) => (
                    <SelectItem key={uses} value={String(uses)}>
                      {INVITE_MAX_USES_LABEL[uses] ?? String(uses)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <label className="flex items-end gap-2 pb-2">
              <Checkbox
                checked={temporary}
                disabled={busy}
                onCheckedChange={(checked) => setTemporary(checked === true)}
              />
              <span className="section-label">MEMBRO TEMPORÁRIO</span>
            </label>
          </div>

          <p className="text-xs opacity-60">
            Membro temporário sai do servidor ao desconectar, a menos que ganhe um cargo.
          </p>

          <div className="flex justify-end border-t-2 border-base-300 pt-4">
            <button
              type="button"
              className="btn-goodchat"
              disabled={busy || channelId.length === 0}
              onClick={() => void create()}
            >
              {busy ? 'CRIANDO_' : 'CRIAR CONVITE'}
            </button>
          </div>
        </Panel>
      )}

      <Panel title="CONVITES.LST">
        <DataTable
          columns={columns}
          data={list.invites as InviteRow[]}
          pageSize={25}
          emptyDescription="Nenhum convite ativo. Convite de uso único some da lista assim que é usado."
        />
      </Panel>

      <AlertDialog open={target !== null} onOpenChange={(next) => !next && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>REVOGAR CONVITE</AlertDialogTitle>
            <AlertDialogDescription>
              {target
                ? `O link ${target.url} para de funcionar. Quem já entrou por ele continua no servidor.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>CANCELAR</AlertDialogCancel>
            <button
              type="button"
              className="btn-goodchat-danger"
              disabled={busy}
              onClick={() => void confirmDelete()}
            >
              {busy ? 'REVOGANDO_' : 'CONFIRMAR'}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
