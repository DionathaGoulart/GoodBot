'use server';

import { MessageTemplateSchema, SnowflakeSchema } from '@cobot/shared';
import { z } from 'zod';

import { defaultGuildId, requireGuildAccess } from '@/lib/auth/require';
import { internalApi } from '@/lib/internal-api';
import { saveModuleConfig, type ActionResult } from '@/lib/module-config';
import { removeTag, saveTag } from '@/lib/tags';

import type { ConfigPage } from '@/lib/config-pages';

/** Salva uma página de `/g/[guildId]/config/*` (PRD §6.2). */
export async function saveConfigPageAction(
  page: ConfigPage,
  formData: FormData,
): Promise<ActionResult> {
  return saveModuleConfig(page, formData);
}

export async function saveTagAction(formData: FormData): Promise<ActionResult> {
  return saveTag(formData);
}

export async function deleteTagAction(formData: FormData): Promise<ActionResult> {
  return removeTag(formData);
}

const WelcomeTestSchema = z.object({
  channelId: SnowflakeSchema,
  template: MessageTemplateSchema,
});

/**
 * Botão `ENVIAR TESTE` da tela de boas-vindas: manda o template **como está no
 * formulário**, sem salvar. Quem renderiza as variáveis é o bot, com ele mesmo
 * de exemplo (`POST /guilds/:id/messages`).
 */
export async function sendWelcomeTestAction(formData: FormData): Promise<ActionResult> {
  const guildId = defaultGuildId();
  await requireGuildAccess(guildId, 'admin');

  const raw = formData.get('payload');
  let parsed;
  try {
    parsed = WelcomeTestSchema.safeParse(JSON.parse(typeof raw === 'string' ? raw : 'null'));
  } catch {
    return { ok: false, message: 'Não consegui ler a mensagem de teste.' };
  }
  if (!parsed.success) {
    return { ok: false, message: 'Escolha um canal e escreva a mensagem antes de testar.' };
  }

  try {
    await internalApi().sendMessage(guildId, {
      kind: 'welcome_test',
      ...parsed.data,
      // O teste imita a mensagem de verdade, e nela `{mention}` pinga quem
      // entrou — só menção de usuário, nunca cargo nem @everyone.
      allowedMentions: { users: true, roles: false, everyone: false },
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'O bot não respondeu.' };
  }
  return { ok: true, message: 'Mensagem de teste enviada.' };
}
