'use client';

import * as React from 'react';
import { MAX_TIMEOUT_MS, MAX_REASON_LENGTH, HOUR_MS } from '@cobot/shared';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { punishMemberAction } from '@/app/actions/guild';
import { DurationInput } from '@/components/config/duration-input';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import type { GuildMemberDetail } from '@cobot/shared';

type ActionType = 'ban' | 'kick' | 'timeout' | 'warn' | 'note';

interface ActionSpec {
  label: string;
  title: string;
  description: string;
  /** Duração obrigatória (timeout) ou opcional (tempban). */
  duration: 'required' | 'optional' | 'none';
  danger: boolean;
}

const ACTIONS: Record<ActionType, ActionSpec> = {
  ban: {
    label: 'BANIR',
    title: 'BANIR MEMBRO',
    description: 'O membro sai do servidor e não pode voltar. Com duração, vira tempban.',
    duration: 'optional',
    danger: true,
  },
  kick: {
    label: 'EXPULSAR',
    title: 'EXPULSAR MEMBRO',
    description: 'O membro sai do servidor, mas pode entrar de novo com um convite.',
    duration: 'none',
    danger: true,
  },
  timeout: {
    label: 'CASTIGO',
    title: 'APLICAR CASTIGO',
    description: 'O membro fica sem falar nem reagir pelo tempo escolhido (até 28 dias).',
    duration: 'required',
    danger: false,
  },
  warn: {
    label: 'ADVERTIR',
    title: 'ADVERTIR MEMBRO',
    description: 'Registra um aviso. A escalada configurada pode punir sozinha a partir dele.',
    duration: 'none',
    danger: false,
  },
  note: {
    label: 'NOTA',
    title: 'ANOTAR SOBRE O MEMBRO',
    description: 'Só a equipe vê. Não notifica o membro nem conta para a escalada.',
    duration: 'none',
    danger: false,
  },
};

const ORDER: ActionType[] = ['ban', 'kick', 'timeout', 'warn', 'note'];

/**
 * §6.3 — punir pelo painel. Motivo é obrigatório em todas: um caso sem motivo
 * é inútil no mod-log três meses depois, e o Discord também guarda esse texto
 * no audit log dele.
 */
export function MemberModeration({ member }: { member: GuildMemberDetail }) {
  const router = useRouter();
  const [open, setOpen] = React.useState<ActionType | null>(null);
  const [reason, setReason] = React.useState('');
  const [durationMs, setDurationMs] = React.useState(HOUR_MS);
  const [busy, setBusy] = React.useState(false);
  const spec = open ? ACTIONS[open] : null;

  const close = () => {
    setOpen(null);
    setReason('');
    setDurationMs(HOUR_MS);
  };

  async function confirm() {
    if (!open || !spec) return;
    if (reason.trim().length === 0) {
      toast.error('ERRO', { description: 'O motivo é obrigatório.' });
      return;
    }

    setBusy(true);
    try {
      const formData = new FormData();
      formData.set(
        'action',
        JSON.stringify({
          type: open,
          targetId: member.id,
          reason: reason.trim(),
          ...(spec.duration === 'none' ? {} : { durationMs }),
        }),
      );
      const result = await punishMemberAction(formData);
      if (!result.ok) {
        toast.error('ERRO', { description: result.message });
        return;
      }
      toast.success('APLICADO', { description: result.message });
      close();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="MODERAR.EXE">
      <div className="flex flex-wrap gap-2">
        {ORDER.map((type) => (
          <button
            key={type}
            type="button"
            className={ACTIONS[type].danger ? 'btn-goodchat-danger' : 'btn-goodchat-outline'}
            disabled={member.bot}
            onClick={() => setOpen(type)}
          >
            {ACTIONS[type].label}
          </button>
        ))}
      </div>
      {member.bot ? (
        <p className="screen-meta">BOTS NÃO SÃO MODERADOS PELO PAINEL</p>
      ) : (
        <p className="screen-meta">
          A HIERARQUIA DE CARGOS DO DISCORD VALE AQUI: O BOT RECUSA O QUE VOCÊ NÃO PODERIA FAZER
        </p>
      )}

      <AlertDialog open={open !== null} onOpenChange={(next) => !next && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{spec?.title}</AlertDialogTitle>
            <AlertDialogDescription>{spec?.description}</AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-4 px-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="punish-reason">
                Motivo<span className="text-accent"> *</span>
              </Label>
              <Input
                id="punish-reason"
                value={reason}
                maxLength={MAX_REASON_LENGTH}
                placeholder="Spam no #geral"
                onChange={(event) => setReason(event.target.value)}
              />
            </div>

            {spec && spec.duration !== 'none' ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="punish-duration">
                  Duração
                  {spec.duration === 'required' ? <span className="text-accent"> *</span> : null}
                </Label>
                <DurationInput
                  id="punish-duration"
                  value={durationMs}
                  max={open === 'timeout' ? MAX_TIMEOUT_MS : undefined}
                  onChange={setDurationMs}
                />
              </div>
            ) : null}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>CANCELAR</AlertDialogCancel>
            <button
              type="button"
              className={spec?.danger ? 'btn-goodchat-danger' : 'btn-goodchat'}
              disabled={busy || reason.trim().length === 0}
              onClick={confirm}
            >
              {busy ? 'APLICANDO_' : 'CONFIRMAR'}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}
