import { z } from 'zod';

import { moduleConfigBase } from './common';

/** Config global; os painéis ficam em `reaction_role_panels`/`_items`. */
export const ReactionRolesConfigSchema = z.object({
  ...moduleConfigBase,
  /** Confirmar em mensagem efêmera quando um cargo é adicionado/removido. */
  ephemeralFeedback: z.boolean().default(true),
  /** No estilo `reactions`, remover a reação do usuário após processar. */
  removeReactionAfter: z.boolean().default(false),
  maxPanels: z.number().int().min(1).max(100).default(25),
});
export type ReactionRolesConfig = z.infer<typeof ReactionRolesConfigSchema>;
export const DEFAULT_REACTION_ROLES_CONFIG: ReactionRolesConfig = ReactionRolesConfigSchema.parse(
  {},
);
