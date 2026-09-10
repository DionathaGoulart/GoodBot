'use client';

import * as React from 'react';
import { MAX_REASON_LENGTH } from '@goodbot/shared';

import { approveGuildAction, blockGuildAction } from '@/app/actions/admin';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { StatusTag, relativeTime } from '../status-tag';
import { useAdminAction } from '../use-admin-action';

import type { AdminGuildRow } from '@/lib/admin';

/**
 * A fila de decisão (plano, Etapa 4, item 2).
 *
 * Aprovar é direto: é uma escrita no banco e o bot a lê em até um minuto, então
 * não há o que confirmar — e desfazer é bloquear, que está ao lado. Bloquear é
 * `AlertDialog` porque o bot **sai** do servidor, o que é visível para gente que
 * não é nós.
 */
export function QueueList({ rows }: { rows: readonly AdminGuildRow[] }) {
  const { busy, run } = useAdminAction();
  const [alvo, setAlvo] = React.useState<AdminGuildRow | null>(null);
  const [motivo, setMotivo] = React.useState('');

  if (rows.length === 0) {
    return (
      <EmptyState
        title="FILA VAZIA"
        description="Ninguém esperando decisão. Servidores aparecem aqui quando entram pelo convite normal ou quando a demonstração deles acaba."
      />
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li
            key={row.guildId}
            className="flex flex-wrap items-start gap-3 border-2 border-base-300 bg-base-100 px-3 py-3"
          >
            <AvatarSq src={row.live?.iconUrl} name={row.live?.name ?? row.guildId} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{row.live?.name ?? row.guildId}</p>
              <p className="screen-meta select-all">{row.guildId}</p>
              <p className="screen-meta">
                {row.live ? `${String(row.live.memberCount)} membros · dono ${row.live.ownerTag ?? row.live.ownerId}` : 'O BOT NÃO ESTÁ NESTE SERVIDOR'}
              </p>
              <p className="screen-meta">
                CONVIDADO {relativeTime(row.invitedAt)}
                {row.invitedBy ? ` POR ${row.invitedBy}` : ''}
                {row.demoSpent ? ' · JÁ USOU A DEMONSTRAÇÃO' : ''}
              </p>
              {row.note ? <p className="screen-meta">NOTA: {row.note}</p> : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <StatusTag row={row} />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-goodchat"
                  disabled={busy !== null}
                  onClick={() => {
                    void run(`ok:${row.guildId}`, approveGuildAction, { guildId: row.guildId });
                  }}
                >
                  {busy === `ok:${row.guildId}` ? 'APROVANDO_' : 'APROVAR'}
                </button>
                <button
                  type="button"
                  className="btn-goodchat-danger"
                  disabled={busy !== null}
                  onClick={() => {
                    setAlvo(row);
                    setMotivo('');
                  }}
                >
                  RECUSAR
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <AlertDialog
        open={alvo !== null}
        onOpenChange={(open) => {
          if (!open) setAlvo(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>BLOQUEAR {alvo?.live?.name ?? alvo?.guildId}?</AlertDialogTitle>
            <AlertDialogDescription>
              O servidor entra na blocklist e o bot sai dele. Convidá-lo de novo não adianta: ele
              sai outra vez assim que entrar. Para só remover o bot sem impedir a volta, use SAIR
              na tela de Servidores.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="block-note">Motivo (fica no registro e vira a despedida)</Label>
            <Textarea
              id="block-note"
              value={motivo}
              maxLength={MAX_REASON_LENGTH}
              rows={2}
              onChange={(event) => {
                setMotivo(event.target.value);
              }}
            />
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
                void run(`block:${row.guildId}`, blockGuildAction, {
                  guildId: row.guildId,
                  note: motivo,
                }).then((result) => {
                  if (result?.ok) setAlvo(null);
                });
              }}
            >
              {busy?.startsWith('block:') ? 'BLOQUEANDO_' : 'BLOQUEAR E SAIR'}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
