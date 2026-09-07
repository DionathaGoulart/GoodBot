'use client';

import * as React from 'react';
import { MAX_REASON_LENGTH } from '@cobot/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

import { loadMoreBansAction, unbanUserAction } from '@/app/actions/guild';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import type { GuildBanPage, GuildBanSummary } from '@cobot/shared';

type BanRow = GuildBanSummary & Record<string, unknown>;

function DateCell({ value }: { value: string | null }) {
  if (!value) return <span className="screen-meta">—</span>;
  return (
    <time dateTime={value} title={value} className="screen-meta">
      {new Date(value).toLocaleDateString('pt-BR')}
    </time>
  );
}

/**
 * §6.3 — a lista de banidos. O Discord só pagina por ID e não guarda essa
 * lista em lugar nenhum do nosso banco, então "carregar mais" continua do
 * cursor que o bot devolveu, em vez de repaginar do zero.
 */
export function BansTable({
  guildId,
  page,
  query,
}: {
  guildId: string;
  page: GuildBanPage;
  query: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [term, setTerm] = React.useState(query);
  const [loadingMore, setLoadingMore] = React.useState(false);

  const [target, setTarget] = React.useState<GuildBanSummary | null>(null);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  // O que o "carregar mais" acumulou, amarrado à página que o servidor mandou:
  // quando ela troca (refresh ou busca nova), o acumulado é descartado na
  // própria renderização, sem um efeito que corrige o estado depois.
  const [loaded, setLoaded] = React.useState<{
    source: GuildBanPage;
    extra: GuildBanSummary[];
    cursor: string | null;
  }>({ source: page, extra: [], cursor: page.nextCursor });

  const fresh = loaded.source === page;
  const accumulated = fresh ? loaded.extra : [];
  const cursor = fresh ? loaded.cursor : page.nextCursor;

  const bans = React.useMemo(() => [...page.bans, ...accumulated], [page.bans, accumulated]);

  const search = (event: React.FormEvent) => {
    event.preventDefault();
    const next = new URLSearchParams(searchParams.toString());
    if (term.trim()) next.set('q', term.trim());
    else next.delete('q');
    router.push(`/g/${guildId}/banidos?${next.toString()}`);
  };

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const result = await loadMoreBansAction({ q: query, after: cursor });
      if (!result.ok) {
        toast.error('ERRO', { description: result.message });
        return;
      }
      setLoaded({
        source: page,
        extra: [...accumulated, ...result.page.bans],
        cursor: result.page.nextCursor,
      });
    } finally {
      setLoadingMore(false);
    }
  }

  async function confirmUnban() {
    if (!target) return;
    setBusy(true);
    try {
      const formData = new FormData();
      formData.set('userId', target.user.id);
      formData.set('reason', reason.trim());
      const result = await unbanUserAction(formData);
      if (!result.ok) {
        toast.error('ERRO', { description: result.message });
        return;
      }
      toast.success('DESBANIDO', { description: result.message });
      setTarget(null);
      setReason('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const columns = React.useMemo<PanelColumnDef<BanRow>[]>(
    () => [
      {
        id: 'user',
        header: 'USUÁRIO',
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <AvatarSq src={row.original.user.avatarUrl} name={row.original.user.username} size={24} />
            <span className="font-bold">{row.original.user.username}</span>
            {row.original.user.bot ? <Tag tone="muted">BOT</Tag> : null}
          </span>
        ),
      },
      {
        id: 'id',
        header: 'ID',
        cell: ({ row }) => <span className="screen-meta select-all">{row.original.user.id}</span>,
      },
      {
        id: 'reason',
        header: 'MOTIVO',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm opacity-80">{row.original.reason ?? '[sem motivo]'}</span>
        ),
      },
      {
        id: 'executor',
        header: 'POR',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.executor ? (
            <span className="flex items-center gap-2">
              <AvatarSq
                src={row.original.executor.avatarUrl}
                name={row.original.executor.username}
                size={20}
              />
              <span className="text-sm">{row.original.executor.username}</span>
            </span>
          ) : (
            <span className="screen-meta">—</span>
          ),
      },
      {
        id: 'bannedAt',
        header: 'QUANDO',
        cell: ({ row }) => <DateCell value={row.original.bannedAt} />,
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <button type="button" className="icon-btn" onClick={() => setTarget(row.original)}>
            DESBANIR
          </button>
        ),
      },
    ],
    [],
  );

  return (
    <Panel title="BANIDOS.LST">
      <form onSubmit={search} className="flex flex-wrap gap-2">
        <Input
          className="max-w-xs"
          value={term}
          placeholder="ID, NOME OU MOTIVO"
          onChange={(event) => setTerm(event.target.value)}
        />
        <button type="submit" className="icon-btn">
          BUSCAR
        </button>
      </form>

      {page.executorsResolved ? null : (
        <p className="border-2 border-warning p-3 text-xs text-warning">
          ! O bot não tem a permissão Ver Registro de Auditoria, então a coluna POR fica vazia.
        </p>
      )}

      <DataTable
        columns={columns}
        data={bans as BanRow[]}
        pageSize={50}
        emptyDescription={
          query
            ? 'Nenhum banido com esse ID, nome ou motivo.'
            : 'Ninguém banido neste servidor. Bom sinal.'
        }
      />

      <div className="flex items-center justify-between gap-4">
        <p className="screen-meta">
          {String(bans.length)} BANIDOS CARREGADOS{cursor ? ' · HÁ MAIS' : ''}
        </p>
        {cursor ? (
          <button type="button" className="icon-btn" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? 'CARREGANDO_' : 'CARREGAR MAIS'}
          </button>
        ) : null}
      </div>

      <AlertDialog open={target !== null} onOpenChange={(next) => !next && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>DESBANIR USUÁRIO</AlertDialogTitle>
            <AlertDialogDescription>
              {target
                ? `${target.user.username} volta a poder entrar no servidor. Isso cria um caso e escreve no mod-log, igual ao /unban.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-2 px-4">
            <Label htmlFor="unban-reason">Motivo</Label>
            <Input
              id="unban-reason"
              value={reason}
              maxLength={MAX_REASON_LENGTH}
              placeholder="Apelação aceita"
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>CANCELAR</AlertDialogCancel>
            <button
              type="button"
              className="btn-goodchat"
              disabled={busy}
              onClick={confirmUnban}
            >
              {busy ? 'DESBANINDO_' : 'CONFIRMAR'}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}
