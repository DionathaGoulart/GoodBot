import { z } from 'zod';

import { SnowflakeSchema } from '../config/common';
import { MessageTemplateSchema } from '../templates';

export const MESSAGE_KINDS = ['welcome_test', 'reaction_role_panel', 'ticket_panel'] as const;

/** `POST /guilds/:id/messages` — envia ou edita uma mensagem gerenciada. */
export const SendMessageInputSchema = z.object({
  kind: z.enum(MESSAGE_KINDS),
  channelId: SnowflakeSchema,
  /** Presente = editar em vez de enviar. */
  messageId: SnowflakeSchema.optional(),
  template: MessageTemplateSchema,
  /** ID do painel (reaction role / ticket) para montar os componentes. */
  panelId: z.string().uuid().optional(),
});
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

export const SendMessageResultSchema = z.object({
  channelId: SnowflakeSchema,
  messageId: SnowflakeSchema,
});
export type SendMessageResult = z.infer<typeof SendMessageResultSchema>;

/** `POST /guilds/:id/reaction-roles/:id/publish` e `/tickets/panel/publish`. */
export const PublishPanelInputSchema = z.object({
  channelId: SnowflakeSchema.optional(),
});
export type PublishPanelInput = z.infer<typeof PublishPanelInputSchema>;
