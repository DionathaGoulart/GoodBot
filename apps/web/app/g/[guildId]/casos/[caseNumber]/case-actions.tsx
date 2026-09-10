'use client';

import * as React from 'react';
import { MAX_REASON_LENGTH } from '@goodbot/shared';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { deleteCaseAction, editCaseReasonAction, undoCaseAction } from '@/app/actions/cases';
import { Panel } from '@/components/retro/panel';
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
import { useGuildId } from '@/lib/use-guild-id';

import type { CaseDetail } from '@/lib/cases';

const UNDO_LABEL = { unban: 'DESFAZER BAN', untimeout: 'DESFAZER CASTIGO' } as const;

/**
 * §6.4 — o que dá para fazer com um caso já registrado: corrigir o motivo,
 * desfazer a punição enquanto ela vale e, para admin, tirar do histórico.
 * Apagar é `AlertDialog` porque some da vista do usuário punido.
 */
export function CaseActions({
  detail,
  canDelete,
}: {
  detail: CaseDetail;
  /** `admin` (PRD §9.2). */
  canDelete: boolean;
}) {
  const guildId = useGuildId();
  const router = useRouter();
  const { kase, undo } = detail;
  const [reason, setReason] = React.useState(kase.reason);
  const [busy, setBusy] = React.useState<'edit' | 'undo' | 'delete' | null>(null);
  const [confirming, setConfirming] = React.useState(false);

  const deleted = kase.deletedAt !== null;

  async function run(
    kind: 'edit' | 'undo' | 'delete',
    action: (guildId: string, formData: FormData) => Promise<{ ok: boolean; message?: string }>,
    extra: Record<string, string> = {},
  ) {
    setBusy(kind);
    try {
      const formData = new FormData();
      formData.set('caseNumber', String(kase.caseNumber));
      for (const [key, value] of Object.entries(extra)) formData.set(key, value);

      const result = await action(guildId, formData);
      if (!result.ok) {
        toast.error('ERRO', { description: result.message });
        return false;
      }
      toast.success('PRONTO', { description: result.message });
      router.refresh();
      return true;
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title="CASO.EXE">
      <div className="flex flex-col gap-2">
        <Label htmlFor="case-reason">Motivo</Label>
        <Textarea
          id="case-reason"
          value={reason}
          maxLength={MAX_REASON_LENGTH}
          disabled={deleted}
          rows={3}
          onChange={(event) => setReason(event.target.value)}
        />
        <p className="screen-meta">EDITAR AQUI TAMBÉM REESCREVE A MENSAGEM DO MOD-LOG</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-goodchat"
          disabled={
            busy !== null || deleted || reason.trim().length === 0 || reason.trim() === kase.reason
          }
          onClick={() => void run('edit', editCaseReasonAction, { reason: reason.trim() })}
        >
          {busy === 'edit' ? 'SALVANDO_' : 'SALVAR MOTIVO'}
        </button>

        {undo ? (
          <button
            type="button"
            className="btn-goodchat-outline"
            disabled={busy !== null}
            onClick={() => void run('undo', undoCaseAction)}
          >
            {busy === 'undo' ? 'DESFAZENDO_' : UNDO_LABEL[undo]}
          </button>
        ) : null}

        {canDelete && !deleted ? (
          <button
            type="button"
            className="btn-goodchat-danger"
            disabled={busy !== null}
            onClick={() => setConfirming(true)}
          >
            APAGAR
          </button>
        ) : null}
      </div>

      {deleted ? (
        <p className="screen-meta">
          ESTE CASO FOI APAGADO E NÃO CONTA MAIS NO HISTÓRICO DO USUÁRIO
        </p>
      ) : null}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>APAGAR O CASO #{kase.caseNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              Ele sai do histórico do usuário e da escalada, mas continua no banco para auditoria. A
              punição em si não é desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>CANCELAR</AlertDialogCancel>
            <button
              type="button"
              className="btn-goodchat-danger"
              disabled={busy !== null}
              onClick={async () => {
                if (await run('delete', deleteCaseAction)) setConfirming(false);
              }}
            >
              {busy === 'delete' ? 'APAGANDO_' : 'APAGAR'}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}
