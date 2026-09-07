'use client';

import * as React from 'react';
import { toast } from 'sonner';

import type { ActionResult } from '@/lib/module-config';

/** Tempo que o botão fica armado antes de voltar a `label`. */
const ARM_MS = 3_000;

/**
 * §6.8 — confirmação inline: o botão vira `CONFIRMAR?` por 3s e volta sozinho.
 * Usado por tudo que apaga sem tela de detalhe (regra, painel, tipo).
 */
export function ConfirmButton({
  label = 'APAGAR',
  action,
  successTitle = 'APAGADO',
  successMessage,
  onDone,
  disabled,
}: {
  label?: string;
  action: () => Promise<ActionResult>;
  successTitle?: string;
  successMessage?: string;
  onDone?: () => void;
  disabled?: boolean;
}) {
  const [armed, setArmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      disabled={busy || disabled}
      className={armed ? 'icon-btn border-error text-error-text' : 'icon-btn'}
      onClick={async () => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setBusy(true);
        try {
          const result = await action();
          if (result.ok) {
            toast.success(successTitle, { description: result.message ?? successMessage });
            onDone?.();
          } else {
            toast.error('ERRO', { description: result.message });
          }
        } finally {
          setBusy(false);
          setArmed(false);
        }
      }}
    >
      {armed ? 'CONFIRMAR?' : label}
    </button>
  );
}

/** Botão de ação simples (publicar, fechar…) com toast e estado de envio. */
export function ActionButton({
  label,
  busyLabel = 'ENVIANDO_',
  action,
  successTitle = 'PRONTO',
  onDone,
  disabled,
  className = 'icon-btn',
}: {
  label: string;
  busyLabel?: string;
  action: () => Promise<ActionResult>;
  successTitle?: string;
  onDone?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = React.useState(false);

  return (
    <button
      type="button"
      className={className}
      disabled={busy || disabled}
      onClick={async () => {
        setBusy(true);
        try {
          const result = await action();
          if (result.ok) {
            toast.success(successTitle, { description: result.message });
            onDone?.();
          } else {
            toast.error('ERRO', { description: result.message });
          }
        } catch {
          toast.error('ERRO', { description: 'Não foi possível falar com o servidor.' });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? busyLabel : label}
    </button>
  );
}
