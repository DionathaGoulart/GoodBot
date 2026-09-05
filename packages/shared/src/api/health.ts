import { z } from 'zod';

export const GATEWAY_STATUSES = ['ready', 'connecting', 'reconnecting', 'disconnected'] as const;

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  uptimeMs: z.number().int().min(0),
  gateway: z.object({
    status: z.enum(GATEWAY_STATUSES),
    /** Ping do websocket em ms; `null` quando desconectado. */
    pingMs: z.number().int().nullable(),
  }),
  database: z.object({ ok: z.boolean(), latencyMs: z.number().int().nullable() }),
  guilds: z.object({ cached: z.number().int().min(0), expected: z.number().int().min(0) }),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
