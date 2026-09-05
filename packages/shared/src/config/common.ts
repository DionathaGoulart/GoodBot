import { z } from 'zod';

import { isSnowflake } from '../snowflake';

/** ID do Discord como string de 17–20 dígitos. */
export const SnowflakeSchema = z
  .string()
  .refine(isSnowflake, { message: 'ID do Discord inválido' });

/** Lista de IDs sem repetição (vazia por padrão). */
export const SnowflakeListSchema = z
  .array(SnowflakeSchema)
  .max(100)
  .transform((ids) => [...new Set(ids)])
  .default([]);

/** ID opcional (`null` = não configurado). */
export const NullableSnowflakeSchema = SnowflakeSchema.nullable().default(null);

/** Duração em ms, positiva e inteira. */
export const DurationMsSchema = z.number().int().positive();

/** Todo config de módulo começa com `version` e `enabled`. */
export const CONFIG_VERSION = 1 as const;
export const moduleConfigBase = {
  version: z.literal(CONFIG_VERSION).default(CONFIG_VERSION),
  enabled: z.boolean().default(false),
};
