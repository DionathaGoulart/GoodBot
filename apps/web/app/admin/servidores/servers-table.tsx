'use client';

import * as React from 'react';
import { MAX_REASON_LENGTH } from '@goodbot/shared';

import { leaveGuildAction } from '@/app/actions/admin';
import { AvatarSq } from '@/components/retro/avatar-sq';
import { EmptyState } from '@/components/retro/states';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { StatusTag, relativeTime } from '../status-tag';
import { useAdminAction } from '../use-admin-action';

import type { AdminGuildRow } from '@/lib/admin';

/**
 * Listar e expulsar (plano, Etapa 4, item 1).
 *
 * Expulsar é `AlertDialog` porque o bot fala num servidor que não é nosso e
 * some de lá — e porque o motivo digitado vira a mensagem de despedida. Não é
 * o mesmo que bloquear: o status decidido continua valendo, então o servidor
 * pode reconvidar o bot e ele volta a atender.
 */
export function ServersTable({ rows }: { rows: readonly AdminGuildRow[] }) {
  const { busy, run } = useAdminAction();
  const [alvo, setAlvo] = React.useState<AdminGuildRow | null>(null);
  const [motivo, setMotivo] = React.useState('');
  const [avisar, setAvisar] = React.useState(true);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="REGISTRO VAZIO"
        description="Nenhum servidor no registro ainda. Eles aparecem quando alguém convida o bot."
      />
    );
  }

  function abrir(row: AdminGuildRow) {
    setAlvo(row);
    setMotivo('');
    setAvisar(true);
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-base-300 bg-base-100 text-left">
              <th className="section-label px-3 py-2">Servidor</th>
              <th className="section-label px-3 py-2">Status</th>
              <th className="section-label px-3 py-2 text-right">Membros</th>
              <th className="section-label px-3 py-2">Dono</th>
              <th className="section-label px-3 py-2">Entrou</th>
              <th className="section-label px-3 py-2 text-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.guildId} className="border-b border-base-300/30">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <AvatarSq src={row.live?.iconUrl} name={row.live?.name ?? row.guildId} size={24} />
                    <span className="min-w-0">
                      <span className="block truncate font-bold">
                        {row.live?.name ?? row.guildId}
                      </span>
                      <span className="screen-meta select-all">{row.guildId}</span>
                    </span>
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="flex flex-col items-start gap-1">
                    <StatusTag row={row} />
                    {row.status === 'demo' && !row.demoSpent && row.expiresAt ? (
                      <span className="screen-meta">acaba {relativeTime(row.expiresAt)}</span>
                    ) : null}
                    {row.note ? <span className="screen-meta">{row.note}</span> : null}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.live ? row.live.memberCount : '—'}
                </td>
                <td className="px-3 py-2">
                  {row.live ? (
                    <span className="flex flex-col">
                      <span className="truncate">{row.live.ownerTag ?? '—'}</span>
                      <span className="screen-meta select-all">{row.live.ownerId}</span>
                    </span>
                  ) : (
                    <span className="screen-meta">BOT FORA DO SERVIDOR</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className="flex flex-col">
                    <span className="screen-meta">{relativeTime(row.live?.joinedAt ?? row.invitedAt)}</span>
                    {row.leftAt ? <span className="screen-meta">SAIU {relativeTime(row.leftAt)}</span> : null}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    className="btn-goodchat-danger"
                    // Sem o bot no servidor não há de onde sair; o botão fica
                    // desligado em vez de sumir, senão a coluna dança de linha
                    // em linha e ninguém acha o botão duas vezes no mesmo lugar.
                    disabled={busy !== null || row.live === null}
                    onClick={() => {
                      abrir(row);
                    }}
                  >
                    SAIR
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AlertDialog
        open={alvo !== null}
        onOpenChange={(open) => {
          if (!open) setAlvo(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>SAIR DE {alvo?.live?.name ?? alvo?.guildId}?</AlertDialogTitle>
            <AlertDialogDescription>
              O bot sai do servidor. O status no registro continua valendo, então este servidor
              pode convidá-lo de novo — para impedir isso, bloqueie pela fila. Nada é apagado:
              casos, tags, tickets e configuração ficam guardados.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="leave-reason">Motivo (vai na mensagem de despedida)</Label>
            <Textarea
              id="leave-reason"
              value={motivo}
              maxLength={MAX_REASON_LENGTH}
              rows={2}
              onChange={(event) => {
                setMotivo(event.target.value);
              }}
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={avisar}
                onCheckedChange={(checked) => {
                  setAvisar(checked === true);
                }}
              />
              Avisar no servidor antes de sair
            </label>
          </div>

          <AlertDialogFooter>
            <button
              type="button"
              className="btn-goodchat-outline"
              disabled={busy !== null}
              onClick={() => {
                setAlvo(null);
              }}
            >
              CANCELAR
            </button>
            <button
              type="button"
              className="btn-goodchat-danger"
              disabled={busy !== null || alvo === null}
              onClick={() => {
                const row = alvo;
                if (!row) return;
                void run(row.guildId, leaveGuildAction, {
                  guildId: row.guildId,
                  note: motivo,
                  announce: String(avisar),
                }).then((result) => {
                  if (result?.ok) setAlvo(null);
                });
              }}
            >
              {busy !== null ? 'SAINDO_' : 'SAIR'}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
