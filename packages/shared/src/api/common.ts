import { z } from 'zod';

import { SnowflakeSchema } from '../config/common';

export const GuildIdParamSchema = z.object({ guildId: SnowflakeSchema });
export type GuildIdParam = z.infer<typeof GuildIdParamSchema>;

/** Formato único de erro da API interna. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** Detalhes de validação (issues do Zod), quando houver. */
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ApiOkSchema = z.object({ ok: z.literal(true) });
export type ApiOk = z.infer<typeof ApiOkSchema>;

/** Query `?limit=` com teto por endpoint. */
export const limitQuery = (max: number, def: number) =>
  z.coerce.number().int().min(1).max(max).default(def);
