import { z } from 'zod';

import { moduleConfigBase, NullableSnowflakeSchema } from './common';

/** Config global; tipos e painéis ficam em `ticket_types`/`ticket_panels`. */
export const TicketsConfigSchema = z.object({
  ...moduleConfigBase,
  /** Canal que recebe transcripts e avisos de abertura/fechamento. */
  logChannelId: NullableSnowflakeSchema,
  /** Abrir como thread privada em vez de canal. */
  useThreads: z.boolean().default(false),
  transcript: z
    .object({
      format: z.enum(['html', 'txt']).default('html'),
      sendToUser: z.boolean().default(true),
    })
    .default({ format: 'html', sendToUser: true }),
  /** Limite padrão de tickets abertos por usuário (tipos podem sobrescrever). */
  maxOpenPerUserDefault: z.number().int().min(1).max(20).default(1),
  /** Padrão de nome do canal; aceita `{number}`, `{user}` e `{type}`. */
  namingPattern: z.string().min(1).max(60).default('ticket-{number}'),
  /** Pedir confirmação antes de fechar. */
  closeConfirm: z.boolean().default(true),
  /** Fechar automaticamente tickets sem atividade após N horas; 0 = nunca. */
  autoCloseInactiveHours: z.number().int().min(0).max(720).default(0),
});
export type TicketsConfig = z.infer<typeof TicketsConfigSchema>;
export const DEFAULT_TICKETS_CONFIG: TicketsConfig = TicketsConfigSchema.parse({});
