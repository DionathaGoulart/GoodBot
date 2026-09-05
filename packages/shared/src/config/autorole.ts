import { z } from 'zod';

import { moduleConfigBase, NullableSnowflakeSchema, SnowflakeListSchema } from './common';

export const AutoroleConfigSchema = z.object({
  ...moduleConfigBase,
  humanRoleIds: SnowflakeListSchema,
  botRoleIds: SnowflakeListSchema,
  /** Atraso antes de aplicar os cargos (0 = imediato). */
  delaySeconds: z.number().int().min(0).max(3_600).default(0),
  verify: z
    .object({
      enabled: z.boolean().default(false),
      channelId: NullableSnowflakeSchema,
      messageId: NullableSnowflakeSchema,
      roleId: NullableSnowflakeSchema,
      buttonLabel: z.string().min(1).max(80).default('Verificar'),
    })
    .default({
      enabled: false,
      channelId: null,
      messageId: null,
      roleId: null,
      buttonLabel: 'Verificar',
    }),
});
export type AutoroleConfig = z.infer<typeof AutoroleConfigSchema>;
export const DEFAULT_AUTOROLE_CONFIG: AutoroleConfig = AutoroleConfigSchema.parse({});
