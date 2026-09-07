import 'server-only';

import { AllowedMentionsSchema, MessageTemplateSchema, SnowflakeSchema } from '@cobot/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { failure } from './action-error';
import { withAudit } from './audit';
import { defaultGuildId, requireGuildAccess } from './auth/require';
import { internalApi } from './internal-api';
import { toFieldErrors, type ActionResult } from './module-config';

import type { ChannelMessageSummary, GuildChannelSummary } from '@cobot/shared';

const MESSAGES_PATH = (guildId: string) => `/g/${guildId}/mensagens`;

/** O corpo que o compositor manda: o template inteiro em JSON num campo só. */
const ComposeInputSchema = z.object({
  channelId: SnowflakeSchema,
  /** Presente = editar aquela mensagem em vez de mandar uma nova. */
  messageId: SnowflakeSchema.optional(),
  /** Presente = a mensagem sai como resposta a esta. */
  replyToId: SnowflakeSchema.optional(),
  template: MessageTemplateSchema,
  allowedMentions: AllowedMentionsSchema,
});

function parseBody(raw: FormDataEntryValue | null): unknown {
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Os canais onde dá para escrever (§6.2). O que o bot não enxerga continua na
 * lista, com `canSend: false` — o seletor o mostra desabilitado com o motivo,
 * porque sumir com o canal só faria quem procura por ele achar que o painel
 * quebrou.
 */
export async function loadMessageChannels(
  guildId: string,
): Promise<{ channels: GuildChannelSummary[]; error: string | null }> {
  try {
    return { channels: await internalApi().channels(guildId), error: null };
  } catch (error) {
    return { channels: [], error: failure(error).message ?? 'O bot não respondeu.' };
  }
}

export async function loadChannelHistory(
  guildId: string,
  channelId: string,
): Promise<{ messages: ChannelMessageSummary[]; error: string | null }> {
  try {
    return { messages: await internalApi().channelMessages(guildId, channelId), error: null };
  } catch (error) {
    return { messages: [], error: failure(error).message ?? 'O bot não respondeu.' };
  }
}

/**
 * Envia ou edita uma mensagem do bot (§6.2). Só `admin` chega aqui, e tudo
 * que passa vira linha de auditoria **com o conteúdo**: este é o endpoint mais
 * fácil de abusar do painel inteiro, então o que foi escrito precisa ter dono
 * e hora.
 */
export async function sendChannelMessage(formData: FormData): Promise<ActionResult> {
  const guildId = defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const parsed = ComposeInputSchema.safeParse(parseBody(formData.get('message')));
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Confira os campos marcados.',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }
  const input = parsed.data;

  if (!input.template.content?.trim() && !input.template.embed) {
    return { ok: false, message: 'A mensagem está vazia.' };
  }

  // O conteúdo anterior só existe antes da edição acontecer: sem isto, a
  // auditoria mostraria a troca sem dizer o que havia lá.
  const before = input.messageId ? await findMessage(guildId, input) : null;

  let result;
  try {
    result = await internalApi().sendMessage(guildId, {
      kind: 'dashboard',
      channelId: input.channelId,
      ...(input.messageId ? { messageId: input.messageId } : {}),
      ...(input.replyToId ? { replyToId: input.replyToId } : {}),
      template: input.template,
      allowedMentions: input.allowedMentions,
      actorId: session.user.id,
    });
  } catch (error) {
    return failure(error, 'O bot não respondeu; a mensagem não saiu.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name },
    input.messageId ? 'message.edit' : 'message.send',
    { type: 'message', id: result.messageId },
    before,
    {
      channelId: result.channelId,
      messageId: result.messageId,
      ...(input.replyToId ? { replyToId: input.replyToId } : {}),
      template: input.template,
      allowedMentions: input.allowedMentions,
    },
  );

  revalidatePath(MESSAGES_PATH(guildId));
  return { ok: true, message: input.messageId ? 'Mensagem editada.' : 'Mensagem enviada.' };
}

/** Apaga uma mensagem pelo painel; a auditoria guarda o que foi apagado. */
export async function deleteChannelMessage(formData: FormData): Promise<ActionResult> {
  const guildId = defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const channelId = SnowflakeSchema.safeParse(formData.get('channelId'));
  const messageId = SnowflakeSchema.safeParse(formData.get('messageId'));
  if (!channelId.success || !messageId.success) {
    return { ok: false, message: 'Mensagem inválida.' };
  }

  let deleted;
  try {
    deleted = await internalApi().deleteMessage(guildId, channelId.data, messageId.data, {
      actorId: session.user.id,
    });
  } catch (error) {
    return failure(error, 'O bot não respondeu; a mensagem continua lá.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name },
    'message.delete',
    { type: 'message', id: messageId.data },
    deleted,
    null,
  );

  revalidatePath(MESSAGES_PATH(guildId));
  return { ok: true, message: 'Mensagem apagada.' };
}

/** O resumo da mensagem que está prestes a ser editada; `null` se sumiu. */
async function findMessage(
  guildId: string,
  input: { channelId: string; messageId?: string },
): Promise<ChannelMessageSummary | null> {
  try {
    const messages = await internalApi().channelMessages(guildId, input.channelId);
    return messages.find((message) => message.id === input.messageId) ?? null;
  } catch {
    // Falhar aqui não pode impedir a edição: a auditoria fica sem o `before`,
    // e é isso que a linha registra.
    return null;
  }
}
