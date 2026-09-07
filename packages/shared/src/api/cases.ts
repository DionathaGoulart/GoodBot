import { z } from 'zod';

import { SnowflakeSchema } from '../config/common';
import { CASE_SOURCES, CASE_TYPES, MAX_REASON_LENGTH } from '../constants';

/** `PATCH /guilds/:id/cases/:caseNumber` — editar o motivo pelo painel. */
export const CaseEditInputSchema = z.object({
  /** Quem clicou; o bot confere que é moderador de verdade. */
  actorId: SnowflakeSchema,
  reason: z.string().trim().min(1).max(MAX_REASON_LENGTH),
});
export type CaseEditInput = z.infer<typeof CaseEditInputSchema>;

/** `DELETE /guilds/:id/cases/:caseNumber` — soft delete, só admin. */
export const CaseDeleteInputSchema = z.object({ actorId: SnowflakeSchema });
export type CaseDeleteInput = z.infer<typeof CaseDeleteInputSchema>;

/** O caso como a API devolve — o painel já recebe as datas em ISO. */
export const CaseSummarySchema = z.object({
  id: z.number().int(),
  caseNumber: z.number().int(),
  type: z.enum(CASE_TYPES),
  source: z.enum(CASE_SOURCES),
  targetId: SnowflakeSchema,
  targetTag: z.string(),
  actorId: SnowflakeSchema,
  actorTag: z.string(),
  reason: z.string(),
  durationMs: z.number().int().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  modlogChannelId: SnowflakeSchema.nullable(),
  modlogMessageId: SnowflakeSchema.nullable(),
  editedBy: SnowflakeSchema.nullable(),
  editedAt: z.iso.datetime().nullable(),
  deletedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type CaseSummary = z.infer<typeof CaseSummarySchema>;
