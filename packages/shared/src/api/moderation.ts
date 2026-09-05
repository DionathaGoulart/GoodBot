import { z } from 'zod';

import { DurationMsSchema, SnowflakeSchema } from '../config/common';
import {
  CASE_SOURCES,
  CASE_TYPES,
  type CaseType,
  MAX_BAN_DELETE_DAYS,
  MAX_REASON_LENGTH,
  MAX_TIMEOUT_MS,
} from '../constants';

/** Tipos que podem ser executados pelo painel (`POST /guilds/:id/moderation`). */
export const MODERATION_ACTION_TYPES = CASE_TYPES;

const NEEDS_DURATION = new Set<CaseType>(['timeout']);
const ACCEPTS_DURATION = new Set<CaseType>(['ban', 'timeout']);

export const ModerationActionInputSchema = z
  .object({
    type: z.enum(MODERATION_ACTION_TYPES),
    targetId: SnowflakeSchema,
    /** Quem pediu (moderador logado no painel). O bot verifica hierarquia. */
    actorId: SnowflakeSchema,
    reason: z.string().trim().max(MAX_REASON_LENGTH).optional(),
    /** Tempban/timeout. Obrigatório em `timeout`; opcional em `ban`. */
    durationMs: DurationMsSchema.optional(),
    /** Só `ban`/`softban`. */
    deleteMessageDays: z.number().int().min(0).max(MAX_BAN_DELETE_DAYS).optional(),
    source: z.enum(CASE_SOURCES).default('dashboard'),
  })
  .superRefine((input, ctx) => {
    if (input.type === 'ban' && !input.reason) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Ban exige motivo' });
    }
    if (input.type === 'note' && !input.reason) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Nota exige texto' });
    }
    if (NEEDS_DURATION.has(input.type) && input.durationMs === undefined) {
      ctx.addIssue({ code: 'custom', path: ['durationMs'], message: 'Timeout exige duração' });
    }
    if (input.durationMs !== undefined && !ACCEPTS_DURATION.has(input.type)) {
      ctx.addIssue({
        code: 'custom',
        path: ['durationMs'],
        message: `${input.type} não aceita duração`,
      });
    }
    if (input.type === 'timeout' && (input.durationMs ?? 0) > MAX_TIMEOUT_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['durationMs'],
        message: 'Timeout máximo é 28 dias',
      });
    }
    if (input.deleteMessageDays !== undefined && input.type !== 'ban' && input.type !== 'softban') {
      ctx.addIssue({
        code: 'custom',
        path: ['deleteMessageDays'],
        message: 'Só ban/softban apagam mensagens',
      });
    }
  });
export type ModerationActionInput = z.infer<typeof ModerationActionInputSchema>;

export const ModerationActionResultSchema = z.object({
  caseId: z.number().int(),
  caseNumber: z.number().int(),
  type: z.enum(CASE_TYPES),
  expiresAt: z.iso.datetime().nullable(),
  /** `false` quando a DM ao alvo falhou ou está desativada. */
  dmSent: z.boolean(),
});
export type ModerationActionResult = z.infer<typeof ModerationActionResultSchema>;
