import { z } from 'zod';

import { moduleConfigBase } from './common';

/**
 * Config global de logs. Canal e toggle por tipo ficam em `log_configs`
 * (uma linha por `LOG_KINDS`).
 */
export const LogsConfigSchema = z.object({
  ...moduleConfigBase,
  messageCache: z
    .object({
      enabled: z.boolean().default(true),
      /** Mensagens mantidas por canal no LRU em memória. */
      perChannel: z.number().int().min(10).max(1000).default(200),
    })
    .default({ enabled: true, perChannel: 200 }),
  /** Registrar mudança de avatar nos logs de membros. */
  logAvatarChanges: z.boolean().default(false),
  /** Anexar .txt com as mensagens no log de bulk delete. */
  bulkDeleteAttachFile: z.boolean().default(true),
  /** Ignorar mensagens/edições de bots nos logs de mensagens. */
  ignoreBots: z.boolean().default(true),
});
export type LogsConfig = z.infer<typeof LogsConfigSchema>;
export const DEFAULT_LOGS_CONFIG: LogsConfig = LogsConfigSchema.parse({});
