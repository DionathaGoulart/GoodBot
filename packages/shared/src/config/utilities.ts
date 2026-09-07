import { z } from 'zod';

import { DAY_MS, MAX_COMMAND_NAME_LENGTH, MAX_PURGE, MAX_SLOWMODE_SECONDS } from '../constants';
import { DurationMsSchema, moduleConfigBase, SnowflakeListSchema } from './common';

/**
 * Restrições de um comando definidas no painel (PRD §6.2, tela "Comandos").
 * O bot aplica isto **depois** do nível de permissão do comando: um override
 * só consegue apertar o acesso, nunca afrouxar.
 */
export const CommandOverrideSchema = z.object({
  enabled: z.boolean().default(true),
  /** Vazio = qualquer um que já passe no nível do comando. */
  allowedRoleIds: SnowflakeListSchema,
  /** Vazio = todos os canais. */
  allowedChannelIds: SnowflakeListSchema,
  /** Tem precedência sobre `allowedChannelIds`. */
  deniedChannelIds: SnowflakeListSchema,
});
export type CommandOverride = z.infer<typeof CommandOverrideSchema>;
export const DEFAULT_COMMAND_OVERRIDE: CommandOverride = CommandOverrideSchema.parse({});

export const UtilitiesConfigSchema = z.object({
  ...moduleConfigBase,
  enabled: z.boolean().default(true),
  purge: z
    .object({
      maxPerCommand: z.number().int().min(1).max(MAX_PURGE).default(MAX_PURGE),
      logToModlog: z.boolean().default(true),
    })
    .default({ maxPerCommand: MAX_PURGE, logToModlog: true }),
  slowmode: z
    .object({
      maxSeconds: z.number().int().min(1).max(MAX_SLOWMODE_SECONDS).default(MAX_SLOWMODE_SECONDS),
    })
    .default({ maxSeconds: MAX_SLOWMODE_SECONDS }),
  lock: z
    .object({
      /** Cargos além do @everyone que perdem `SendMessages` no lock. */
      extraRoleIds: SnowflakeListSchema,
      /** Canais e categorias afetados pelo `/lockdown`. */
      lockdownChannelIds: SnowflakeListSchema,
      lockdownCategoryIds: SnowflakeListSchema,
      /** Avisar no canal quando ele for trancado/destrancado. */
      announceInChannel: z.boolean().default(true),
    })
    .default({
      extraRoleIds: [],
      lockdownChannelIds: [],
      lockdownCategoryIds: [],
      announceInChannel: true,
    }),
  reminders: z
    .object({
      maxPerUser: z.number().int().min(1).max(100).default(25),
      maxDurationMs: DurationMsSchema.max(365 * DAY_MS).default(365 * DAY_MS),
    })
    .default({ maxPerUser: 25, maxDurationMs: 365 * DAY_MS }),
  polls: z
    .object({
      maxDurationMs: DurationMsSchema.max(30 * DAY_MS).default(7 * DAY_MS),
      /** Cargos que podem criar enquetes; vazio = todos. */
      creatorRoleIds: SnowflakeListSchema,
    })
    .default({ maxDurationMs: 7 * DAY_MS, creatorRoleIds: [] }),
  /**
   * Nome do comando → restrições. Só os comandos alterados no painel entram
   * aqui; quem não está no mapa vale como `DEFAULT_COMMAND_OVERRIDE`.
   */
  commandOverrides: z
    .record(z.string().min(1).max(MAX_COMMAND_NAME_LENGTH), CommandOverrideSchema)
    .default({}),
});
export type UtilitiesConfig = z.infer<typeof UtilitiesConfigSchema>;
export const DEFAULT_UTILITIES_CONFIG: UtilitiesConfig = UtilitiesConfigSchema.parse({});
