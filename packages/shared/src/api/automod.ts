import { z } from 'zod';

/** `POST /guilds/:id/automod/raid` — o botão `ATIVAR MODO RAID` do painel. */
export const RaidModeInputSchema = z.object({
  active: z.boolean(),
  /** Só na ativação; ausente = a duração da regra anti-raid da guild. */
  minutes: z.number().int().min(1).max(1_440).optional(),
});
export type RaidModeInput = z.infer<typeof RaidModeInputSchema>;

/** Estado do modo raid, devolvido pelo `GET` e pelo `POST`. */
export const RaidModeStateSchema = z.object({
  active: z.boolean(),
  /** Quem ligou; `null` quando não está ativo. */
  source: z.enum(['auto', 'manual']).nullable(),
  /** ISO 8601 do fim; `null` quando não está ativo. */
  until: z.string().nullable(),
});
export type RaidModeState = z.infer<typeof RaidModeStateSchema>;
