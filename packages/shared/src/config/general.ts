import { z } from 'zod';

import { moduleConfigBase } from './common';

/**
 * Preferências gerais do bot que não são colunas de `guild_settings`
 * (timezone, cor de embed, cargos e canal de log vivem lá).
 */
export const GeneralConfigSchema = z.object({
  ...moduleConfigBase,
  enabled: z.boolean().default(true),
  locale: z.enum(['pt-BR']).default('pt-BR'),
  /** Respostas de comandos de moderação visíveis só para quem executou. */
  ephemeralModReplies: z.boolean().default(false),
  /** Incluir `Caso #N` na resposta de comandos de moderação. */
  showCaseNumberInReply: z.boolean().default(true),
  /** Apagar a resposta de comandos utilitários (ex.: `/purge`) após N segundos; 0 = manter. */
  autoDeleteUtilityRepliesSeconds: z.number().int().min(0).max(300).default(10),
});
export type GeneralConfig = z.infer<typeof GeneralConfigSchema>;
export const DEFAULT_GENERAL_CONFIG: GeneralConfig = GeneralConfigSchema.parse({});
