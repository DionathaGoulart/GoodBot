import { z } from 'zod';

import { limitQuery } from './common';
import { SnowflakeSchema } from '../config/common';
import { MessageTemplateSchema } from '../templates';

export const MESSAGE_KINDS = [
  'welcome_test',
  'reaction_role_panel',
  'ticket_panel',
  /** Escrita à mão na tela `/mensagens` do painel (Etapa 24). */
  'dashboard',
] as const;

/**
 * Quem a mensagem pode mencionar. Todo campo nasce `false`: no painel, pingar
 * é uma decisão que se marca, nunca um efeito colateral de escrever `@` no
 * texto. `everyone` ainda passa por uma checagem de permissão no bot.
 */
export const AllowedMentionsSchema = z
  .object({
    users: z.boolean().default(false),
    roles: z.boolean().default(false),
    everyone: z.boolean().default(false),
  })
  .default({ users: false, roles: false, everyone: false });
export type AllowedMentions = z.infer<typeof AllowedMentionsSchema>;

/** O padrão do painel, também usado como valor inicial do formulário. */
export const NO_MENTIONS: AllowedMentions = { users: false, roles: false, everyone: false };

/** `POST /guilds/:id/messages` — envia ou edita uma mensagem gerenciada. */
export const SendMessageInputSchema = z
  .object({
    kind: z.enum(MESSAGE_KINDS),
    channelId: SnowflakeSchema,
    /** Presente = editar em vez de enviar. */
    messageId: SnowflakeSchema.optional(),
    /** Presente = a mensagem sai como resposta a esta. Ignorado ao editar. */
    replyToId: SnowflakeSchema.optional(),
    template: MessageTemplateSchema,
    /** ID do painel (reaction role / ticket) para montar os componentes. */
    panelId: z.uuid().optional(),
    allowedMentions: AllowedMentionsSchema,
    /** Quem clicou no painel; obrigatório para mencionar `@everyone`. */
    actorId: SnowflakeSchema.optional(),
  })
  .refine((input) => !input.allowedMentions.everyone || input.actorId !== undefined, {
    message: 'Mencionar @everyone exige identificar quem está enviando.',
    path: ['actorId'],
  });
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

export const SendMessageResultSchema = z.object({
  channelId: SnowflakeSchema,
  messageId: SnowflakeSchema,
});
export type SendMessageResult = z.infer<typeof SendMessageResultSchema>;

/** `GET /guilds/:id/channels/:id/messages` — histórico recente do canal. */
export const MESSAGE_HISTORY_LIMIT = 50;

export const MessageHistoryQuerySchema = z.object({
  limit: limitQuery(MESSAGE_HISTORY_LIMIT, MESSAGE_HISTORY_LIMIT),
});
export type MessageHistoryQuery = z.infer<typeof MessageHistoryQuerySchema>;

export const ChannelMessageSummarySchema = z.object({
  id: SnowflakeSchema,
  channelId: SnowflakeSchema,
  author: z.object({
    id: SnowflakeSchema,
    username: z.string(),
    avatarUrl: z.url().nullable(),
    bot: z.boolean(),
  }),
  /** Primeiras linhas do conteúdo, para a lista do painel. */
  content: z.string(),
  /**
   * A mensagem relida como template, para o editor abrir com o que está lá.
   * `null` quando ela não cabe num `MessageTemplate` (só anexo, mais de um
   * embed, embed com campo que o painel não edita) — aí não dá para editar
   * sem apagar o que o painel não sabe reconstruir.
   */
  template: MessageTemplateSchema.nullable(),
  embedCount: z.number().int().min(0),
  attachmentCount: z.number().int().min(0),
  /** `true` só quando o autor é o próprio bot — é o que o Discord deixa editar. */
  editable: z.boolean(),
  createdAt: z.iso.datetime(),
  editedAt: z.iso.datetime().nullable(),
  url: z.url(),
});
export type ChannelMessageSummary = z.infer<typeof ChannelMessageSummarySchema>;

/** `DELETE /guilds/:id/channels/:id/messages/:id` — apagar pelo painel. */
export const DeleteMessageInputSchema = z.object({
  actorId: SnowflakeSchema,
});
export type DeleteMessageInput = z.infer<typeof DeleteMessageInputSchema>;

/** `POST /guilds/:id/reaction-roles/:id/publish` e `/tickets/panel/publish`. */
export const PublishPanelInputSchema = z.object({
  channelId: SnowflakeSchema.optional(),
});
export type PublishPanelInput = z.infer<typeof PublishPanelInputSchema>;
