import { z } from 'zod';

import { STATS_HOURLY_RETENTION_DAYS } from '../constants';
import { moduleConfigBase, SnowflakeListSchema } from './common';

export const StatsConfigSchema = z.object({
  ...moduleConfigBase,
  enabled: z.boolean().default(true),
  /** Intervalo de flush do agregador em memória para `stat_buckets`. */
  flushIntervalSeconds: z.number().int().min(15).max(600).default(60),
  /** Dias mantendo buckets horários antes de agregar em diários. */
  hourlyRetentionDays: z.number().int().min(7).max(365).default(STATS_HOURLY_RETENTION_DAYS),
  ignoredChannelIds: SnowflakeListSchema,
  trackMessages: z.boolean().default(true),
  trackVoice: z.boolean().default(true),
  trackCommands: z.boolean().default(true),
  /** Ranking de usuários mais ativos (guarda contagem por usuário, sem conteúdo). */
  trackTopUsers: z.boolean().default(true),
});
export type StatsConfig = z.infer<typeof StatsConfigSchema>;
export const DEFAULT_STATS_CONFIG: StatsConfig = StatsConfigSchema.parse({});
