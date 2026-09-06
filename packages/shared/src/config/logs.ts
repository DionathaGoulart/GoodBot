import { z } from 'zod';

import { LOG_KINDS, type LogKind } from '../constants';
import { moduleConfigBase, NullableSnowflakeSchema, SnowflakeListSchema } from './common';

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

/** Uma linha de `log_configs`: um tipo de log com canal e ignorados próprios. */
export const LogKindConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** `null` = herdar `guild_settings.log_channel_id`. */
  channelId: NullableSnowflakeSchema,
  ignoredChannelIds: SnowflakeListSchema,
  ignoredRoleIds: SnowflakeListSchema,
});
export type LogKindConfig = z.infer<typeof LogKindConfigSchema>;
export const DEFAULT_LOG_KIND_CONFIG: LogKindConfig = LogKindConfigSchema.parse({});

/** A grade tipo × (ativo, canal) da tela de logs — todos os tipos, sempre. */
export const LogKindsConfigSchema = z.object(
  Object.fromEntries(LOG_KINDS.map((kind) => [kind, LogKindConfigSchema])) as {
    [K in LogKind]: typeof LogKindConfigSchema;
  },
);
export type LogKindsConfig = z.infer<typeof LogKindsConfigSchema>;

/** A página "Logs" salva o módulo e as linhas de `log_configs` num `SALVAR` só. */
export const LogsPageSchema = z.object({
  module: LogsConfigSchema,
  kinds: LogKindsConfigSchema,
});
export type LogsPageValues = z.infer<typeof LogsPageSchema>;
