import { z } from 'zod';

import { MAX_COMMAND_NAME_LENGTH, MODULES, PERMISSION_LEVELS } from '../constants';

export const COMMAND_KINDS = ['slash', 'user_context'] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

/**
 * `GET /guilds/:id/commands` — o manifesto que o bot realmente carregou. A
 * tela de permissões de comandos do painel (PRD §6.2) se monta a partir daqui,
 * então um comando novo aparece sem deploy do painel.
 */
export const CommandSummarySchema = z.object({
  name: z.string().min(1).max(MAX_COMMAND_NAME_LENGTH),
  description: z.string(),
  module: z.enum(MODULES),
  /** Nível mínimo embutido no comando; o override do painel só aperta. */
  level: z.enum(PERMISSION_LEVELS),
  kind: z.enum(COMMAND_KINDS),
  /** Subcomandos, quando houver (`/ticket abrir`). Só informativo. */
  subcommands: z.array(z.string()).default([]),
});
export type CommandSummary = z.infer<typeof CommandSummarySchema>;
