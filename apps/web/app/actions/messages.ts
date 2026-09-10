'use server';

import { deleteChannelMessage, sendChannelMessage } from '@/lib/messages';

import type { ActionResult } from '@/lib/module-config';

/**
 * As ações da tela `/mensagens` (Etapa 24). Cascas finas sobre `lib/messages`:
 * permissão e auditoria moram lá, junto da escrita.
 */

export async function sendChannelMessageAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return sendChannelMessage(guildId, formData);
}

export async function deleteChannelMessageAction(
  guildId: string,
  formData: FormData,
): Promise<ActionResult> {
  return deleteChannelMessage(guildId, formData);
}
