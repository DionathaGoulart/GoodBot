'use client';

import * as React from 'react';
import { MAX_REASON_LENGTH } from '@goodbot/shared';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import type { ActionResult } from '@/lib/module-config';

export interface ReasonRequest {
  /** "PAUSAR A BUSCA DE ANA?" */
  title: string;
  description?: string;
  danger?: boolean;
  /** Recebe o motivo sem espaços nas pontas. */
  onConfirm: (reason: string) => Promise<ActionResult & { notified?: boolean }>;
  /** Depois de dar certo e fechar o diálogo. */
  onDone?: () => void;
}

const DEFAULT_DESCRIPTION = 'A pessoa recebe uma DM com este motivo.';

/**
 * §6.5 — confirmação das ações de gestão de jogador. O motivo é obrigatório
 * porque vai na DM da pessoa e na auditoria. Erro do bot mantém o diálogo
 * aberto com o texto digitado; a DM que não chega vira aviso, não erro,
 * porque a ação já valeu.
 */
export function ReasonDialog({
  request,
  onClose,
}: {
  request: ReasonRequest | null;
  onClose: () => void;
}) {
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Cada pedido começa com o campo vazio. Ajustado no render, e não num efeito,
  // para o diálogo não abrir um quadro com o motivo da ação anterior.
  const [shown, setShown] = React.useState(request);
  if (request !== shown) {
    setShown(request);
    setReason('');
    setError(null);
  }

  const trimmed = reason.trim();

  async function confirm() {
    if (!request || trimmed.length === 0) return;
    setBusy(true);
    try {
      const result = await request.onConfirm(trimmed);
      if (!result.ok) {
        setError(result.fieldErrors?.reason ?? null);
        toast.error('ERRO', { description: result.message });
        return;
      }
      if (result.notified === false) {
        toast.warning('FEITO, SEM DM', { description: result.message });
      } else {
        toast.success('PRONTO', { description: result.message });
      }
      onClose();
      request.onDone?.();
    } catch {
      toast.error('ERRO', { description: 'Não foi possível falar com o servidor.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={request !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          <AlertDialogDescription>{request?.description ?? DEFAULT_DESCRIPTION}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-2 px-4">
          <Label htmlFor="squad-admin-reason">
            Motivo (vai na DM da pessoa)<span className="text-accent-text"> *</span>
          </Label>
          <Textarea
            id="squad-admin-reason"
            rows={3}
            value={reason}
            maxLength={MAX_REASON_LENGTH}
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              setReason(event.target.value);
              setError(null);
            }}
          />
          <div className="flex items-start justify-between gap-2">
            {error ? <p className="screen-meta text-error-text">! {error}</p> : <span />}
            <span className="screen-meta shrink-0 tabular-nums">
              {reason.length}/{MAX_REASON_LENGTH}
            </span>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>CANCELAR</AlertDialogCancel>
          <button
            type="button"
            className={request?.danger ? 'btn-goodchat-danger' : 'btn-goodchat'}
            disabled={busy || trimmed.length === 0}
            onClick={confirm}
          >
            {busy ? 'SALVANDO_' : 'CONFIRMAR'}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
