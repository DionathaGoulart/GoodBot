import { z } from 'zod';

import { DAY_MS, DEFAULT_REASON, MAX_REASON_LENGTH, MAX_TIMEOUT_MS } from '../constants';
import { DurationMsSchema, moduleConfigBase } from './common';

/** Quais punições enviam DM ao alvo (`note` nunca envia). */
export const DmOnPunishSchema = z.object({
  ban: z.boolean().default(true),
  softban: z.boolean().default(true),
  kick: z.boolean().default(true),
  timeout: z.boolean().default(true),
  warn: z.boolean().default(true),
});
export type DmOnPunish = z.infer<typeof DmOnPunishSchema>;

/** Escalada automática: N warns em X dias → ação. */
export const EscalationStepSchema = z
  .object({
    warns: z.number().int().min(2).max(50),
    withinDays: z.number().int().min(1).max(365).default(30),
    action: z.enum(['timeout', 'kick', 'ban']),
    /** Obrigatório para `timeout`; ignorado nas demais ações. */
    durationMs: DurationMsSchema.max(MAX_TIMEOUT_MS).optional(),
  })
  .refine((s) => s.action !== 'timeout' || s.durationMs !== undefined, {
    message: 'Escalada para timeout exige duração',
    path: ['durationMs'],
  });

export const ModerationConfigSchema = z.object({
  ...moduleConfigBase,
  enabled: z.boolean().default(true),
  dmOnPunish: DmOnPunishSchema.default(DmOnPunishSchema.parse({})),
  /** Texto anexado ao fim da DM de punição (ex.: link para apelação). */
  dmFooter: z.string().max(MAX_REASON_LENGTH).default(''),
  defaultReason: z.string().min(1).max(MAX_REASON_LENGTH).default(DEFAULT_REASON),
  /** Dias de mensagens apagadas por padrão no `/ban` (0–7). */
  banDeleteMessageDaysDefault: z.number().int().min(0).max(7).default(0),
  /** Duração padrão sugerida no modal "Punir…" para timeout. */
  defaultTimeoutMs: DurationMsSchema.max(MAX_TIMEOUT_MS).default(DAY_MS),
  escalation: z
    .object({
      enabled: z.boolean().default(false),
      steps: z
        .array(EscalationStepSchema)
        .max(10)
        .default([])
        .refine(
          (steps) => new Set(steps.map((s) => s.warns)).size === steps.length,
          'Cada quantidade de warns só pode aparecer uma vez',
        ),
    })
    .default({ enabled: false, steps: [] }),
});
export type ModerationConfig = z.infer<typeof ModerationConfigSchema>;
export const DEFAULT_MODERATION_CONFIG: ModerationConfig = ModerationConfigSchema.parse({});
