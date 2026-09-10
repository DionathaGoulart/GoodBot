'use client';

import * as React from 'react';
import {
  BROADCAST_CONFIRMATION,
  MAX_EMBED_DESCRIPTION_LENGTH,
  MAX_EMBED_TITLE_LENGTH,
} from '@goodbot/shared';

import { broadcastAction } from '@/app/actions/admin';
import { Tag } from '@/components/retro/tag';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { useAdminAction } from '../use-admin-action';

import type { BroadcastOutcome } from '@/lib/admin';
import type { BroadcastResult } from '@goodbot/shared';

/**
 * Broadcast.
 *
 * Três travas, e cada uma existe por um motivo diferente:
 *
 * 1. **Ensaio** — mostra em que canal a mensagem cairia em cada servidor,
 *    sem mandar nada. É o único jeito de descobrir antes que num servidor não
 *    há canal em que o bot possa falar.
 * 2. **Confirmação digitada** — o clique errado não pode custar uma mensagem
 *    em dezenas de servidores de terceiros.
 * 3. **A palavra viaja até a API** — uma trava que só existe no navegador
 *    protege contra o dedo, não contra a chamada solta com o token.
 *
 * Não há como desfazer: o bot não apaga o que já publicou.
 */
export function BroadcastForm() {
  const { busy, run } = useAdminAction<BroadcastOutcome>();
  const [title, setTitle] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [preview, setPreview] = React.useState<BroadcastResult | null>(null);
  const [confirming, setConfirming] = React.useState(false);

  const preenchido = title.trim() !== '' && message.trim() !== '';
  const palavraOk = confirm.trim() === BROADCAST_CONFIRMATION;

  async function enviar(dryRun: boolean) {
    const result = await run(dryRun ? 'ensaio' : 'envio', broadcastAction, {
      title: title.trim(),
      message: message.trim(),
      confirm: dryRun ? '' : confirm.trim(),
      dryRun: String(dryRun),
    });
    if (result?.ok && result.result) setPreview(result.result);
    return result;
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="broadcast-title">
          Título <span className="text-accent">*</span>
        </Label>
        <Input
          id="broadcast-title"
          value={title}
          maxLength={MAX_EMBED_TITLE_LENGTH}
          onChange={(event) => {
            setTitle(event.target.value);
            setPreview(null);
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="broadcast-message">
          Mensagem <span className="text-accent">*</span>
        </Label>
        <Textarea
          id="broadcast-message"
          value={message}
          maxLength={MAX_EMBED_DESCRIPTION_LENGTH}
          rows={5}
          onChange={(event) => {
            setMessage(event.target.value);
            setPreview(null);
          }}
        />
        <p className="screen-meta">
          SAI COMO EMBED NO CANAL DE SISTEMA DE CADA SERVIDOR ATENDIDO, OU NO PRIMEIRO EM QUE O BOT
          CONSIGA FALAR
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-goodchat-outline"
          disabled={busy !== null || !preenchido}
          onClick={() => {
            void enviar(true);
          }}
        >
          {busy === 'ensaio' ? 'CONFERINDO_' : 'ENSAIAR (NÃO ENVIA)'}
        </button>
        <button
          type="button"
          className="btn-goodchat-danger"
          disabled={busy !== null || !preenchido}
          onClick={() => {
            setConfirm('');
            setConfirming(true);
          }}
        >
          ENVIAR PARA TODOS
        </button>
      </div>

      {preview ? <Resultado result={preview} /> : null}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ENVIAR PARA TODOS OS SERVIDORES?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta mensagem vai para gente que não é você, em servidores que não são seus, e não
              tem como ser apagada depois. Digite {BROADCAST_CONFIRMATION} para liberar o envio.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="broadcast-confirm">
              Confirmação <span className="text-accent">*</span>
            </Label>
            <Input
              id="broadcast-confirm"
              value={confirm}
              autoComplete="off"
              placeholder={BROADCAST_CONFIRMATION}
              onChange={(event) => {
                setConfirm(event.target.value);
              }}
            />
          </div>

          <AlertDialogFooter>
            <button
              type="button"
              className="btn-goodchat-outline"
              disabled={busy !== null}
              onClick={() => {
                setConfirming(false);
              }}
            >
              CANCELAR
            </button>
            <button
              type="button"
              className="btn-goodchat-danger"
              disabled={busy !== null || !palavraOk}
              onClick={() => {
                void enviar(false).then((result) => {
                  if (result?.ok) setConfirming(false);
                });
              }}
            >
              {busy === 'envio' ? 'ENVIANDO_' : 'ENVIAR'}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Onde a mensagem caiu (ou cairia), servidor por servidor. */
function Resultado({ result }: { result: BroadcastResult }) {
  return (
    <div className="flex flex-col gap-2 border-2 border-base-300 bg-base-100 p-3">
      <p className="section-label sigil">
        {result.dryRun ? 'ENSAIO' : 'RESULTADO'} · {result.total} SERVIDORES
        {result.dryRun ? '' : ` · ${String(result.delivered)} OK · ${String(result.failed)} FALHOU`}
      </p>
      <ul className="flex flex-col gap-1">
        {result.targets.map((target) => (
          <li key={target.guildId} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{target.name}</span>
            <span className="screen-meta">
              {target.channelName ? `#${target.channelName}` : 'SEM CANAL'}
            </span>
            {result.dryRun ? null : (
              <Tag tone={target.delivered ? 'success' : 'error'}>
                {target.delivered ? 'ENVIADO' : (target.error ?? 'FALHOU')}
              </Tag>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
