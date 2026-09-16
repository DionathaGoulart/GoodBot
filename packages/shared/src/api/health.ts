import { z } from 'zod';

export const GATEWAY_STATUSES = ['ready', 'connecting', 'reconnecting', 'disconnected'] as const;

/**
 * Estado do processo do bot. Só chega a quem manda o Bearer — o card "Saúde"
 * do painel (`/g/[guildId]/system`) é o único consumidor (PRD §11).
 */
export const ProcessHealthSchema = z.object({
  /** Memória residente em bytes; a VM tem 1 GB e o container 384 MB. */
  rssBytes: z.number().int().min(0),
  heapUsedBytes: z.number().int().min(0),
  nodeVersion: z.string(),
  /** Sha curto do commit da imagem (`GIT_SHA`), `null` fora da CI. */
  commit: z.string().nullable(),
});
export type ProcessHealth = z.infer<typeof ProcessHealthSchema>;

/** Quanto está represado em cada fila do bot (PRD §7.4). */
export const QueueHealthSchema = z.object({
  /** Embeds de log esperando flush, somando todos os canais. */
  logQueue: z.number().int().min(0),
  /** Mensagens no buffer do `message_cache` antes do INSERT em lote. */
  messageCache: z.number().int().min(0),
  /** Contadores de estatística ainda não gravados. */
  stats: z.number().int().min(0),
});
export type QueueHealth = z.infer<typeof QueueHealthSchema>;

/** Último `pg_dump` visto no volume `backups` (montado read-only no bot). */
export const BackupHealthSchema = z.object({
  at: z.string().nullable(),
  sizeBytes: z.number().int().min(0).nullable(),
  /** `false` quando o dump válido mais recente tem mais de 48h — ou não existe. */
  fresh: z.boolean(),
});
export type BackupHealth = z.infer<typeof BackupHealthSchema>;

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
  process: ProcessHealthSchema.optional(),
  queues: QueueHealthSchema.optional(),
  backup: BackupHealthSchema.optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
