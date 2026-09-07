import { z } from 'zod';

import { MAX_REASON_LENGTH } from '../constants';
import { SnowflakeSchema } from '../config/common';

/** `POST /guilds/:id/tickets/:ticketId/close` — o botão `FECHAR` do painel. */
export const CloseTicketInputSchema = z.object({
  /** Quem clicou; o bot registra no transcript e no log. */
  actorId: SnowflakeSchema,
  reason: z.string().max(MAX_REASON_LENGTH).nullable().default(null),
});
export type CloseTicketInput = z.infer<typeof CloseTicketInputSchema>;

export const CloseTicketResultSchema = z.object({
  ticketId: z.number().int(),
  transcriptUrl: z.string().nullable(),
});
export type CloseTicketResult = z.infer<typeof CloseTicketResultSchema>;
