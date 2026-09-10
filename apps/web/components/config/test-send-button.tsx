'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { useFormContext } from 'react-hook-form';
import { toast } from 'sonner';

import { sendWelcomeTestAction } from '@/app/actions/config';

import type { MessageTemplate } from '@goodbot/shared';

/**
 * §6.2 — "enviar teste": manda o template **como está no formulário**, sem
 * salvar. Serve para ver o embed no Discord antes de decidir; quem renderiza
 * as variáveis é o bot.
 */
export function TestSendButton({
  channelPath,
  templatePath,
}: {
  channelPath: string;
  templatePath: string;
}) {
  const { guildId } = useParams<{ guildId: string }>();
  const { watch, formState } = useFormContext();
  const [sending, setSending] = React.useState(false);

  const channelId = watch(channelPath) as string | null;
  const template = watch(templatePath) as MessageTemplate | null;
  const ready = Boolean(channelId) && template !== null;

  return (
    <button
      type="button"
      className="icon-btn"
      disabled={sending || !ready || formState.disabled}
      onClick={async () => {
        setSending(true);
        try {
          const formData = new FormData();
          formData.set('guildId', guildId);
          formData.set('payload', JSON.stringify({ channelId, template }));
          const result = await sendWelcomeTestAction(formData);
          if (result.ok) toast.success('ENVIADO', { description: result.message });
          else toast.error('ERRO', { description: result.message ?? 'Não foi possível enviar.' });
        } finally {
          setSending(false);
        }
      }}
    >
      {sending ? 'ENVIANDO_' : 'ENVIAR TESTE'}
    </button>
  );
}
