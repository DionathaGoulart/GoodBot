import { z } from 'zod';

import { MODULES } from '../constants';

/** `POST /guilds/:id/config/invalidate` — o painel chama após salvar. */
export const InvalidateInputSchema = z.object({
  /** Ausente = invalidar todos os módulos da guild. */
  module: z.enum(MODULES).optional(),
});
export type InvalidateInput = z.infer<typeof InvalidateInputSchema>;
