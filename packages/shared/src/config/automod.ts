import { z } from 'zod';

import { moduleConfigBase, SnowflakeListSchema } from './common';

/**
 * Config global do automod. As regras em si vivem em `automod_rules`
 * (ver `automod-rule.ts`); aqui ficam isenções globais e limites de execução.
 */
export const AutomodConfigSchema = z.object({
  ...moduleConfigBase,
  /** Cargos/canais isentos de todas as regras. */
  exemptRoleIds: SnowflakeListSchema,
  exemptChannelIds: SnowflakeListSchema,
  /** Administradores e quem tem `ManageMessages` são isentos por padrão. */
  exemptModerators: z.boolean().default(true),
  /** Tempo máximo de execução de um regex do filtro de palavras. */
  regexTimeoutMs: z.number().int().min(5).max(500).default(50),
  /** Também avaliar edições de mensagem (`messageUpdate`). */
  checkEdits: z.boolean().default(true),
  /** Estado do modo raid ativado manualmente com `/raid on`. */
  raidModeManual: z.boolean().default(false),
});
export type AutomodConfig = z.infer<typeof AutomodConfigSchema>;
export const DEFAULT_AUTOMOD_CONFIG: AutomodConfig = AutomodConfigSchema.parse({});
