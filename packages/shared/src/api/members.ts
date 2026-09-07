import { z } from 'zod';

import { limitQuery } from './common';
import { SnowflakeSchema } from '../config/common';

export const MemberSearchQuerySchema = z.object({
  /** Nome, apelido, tag ou ID. */
  q: z.string().trim().max(100).default(''),
  limit: limitQuery(100, 25),
});
export type MemberSearchQuery = z.infer<typeof MemberSearchQuerySchema>;

export const GuildMemberSummarySchema = z.object({
  id: SnowflakeSchema,
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.url().nullable(),
  bot: z.boolean(),
  joinedAt: z.iso.datetime().nullable(),
  roleIds: z.array(SnowflakeSchema),
});
export type GuildMemberSummary = z.infer<typeof GuildMemberSummarySchema>;

export const GuildMemberDetailSchema = GuildMemberSummarySchema.extend({
  createdAt: z.iso.datetime(),
  /** Fim do timeout ativo, se houver. */
  communicationDisabledUntil: z.iso.datetime().nullable(),
  /** Maior posição de cargo (para checar hierarquia no painel). */
  highestRolePosition: z.number().int(),
  pending: z.boolean(),
});
export type GuildMemberDetail = z.infer<typeof GuildMemberDetailSchema>;

export const GuildChannelSummarySchema = z.object({
  id: SnowflakeSchema,
  name: z.string(),
  /** `ChannelType` do discord.js como número. */
  type: z.number().int(),
  parentId: SnowflakeSchema.nullable(),
  position: z.number().int(),
  /**
   * `false` quando o bot não consegue ver ou falar no canal. Opcional porque
   * só as telas que escrevem mensagem precisam disso (Etapa 24); as outras
   * continuam recebendo o resumo sem ele.
   */
  canSend: z.boolean().optional(),
});
export type GuildChannelSummary = z.infer<typeof GuildChannelSummarySchema>;

export const GuildRoleSummarySchema = z.object({
  id: SnowflakeSchema,
  name: z.string(),
  color: z.number().int(),
  position: z.number().int(),
  managed: z.boolean(),
  /** Mostra o cargo separado na lista de membros. */
  hoist: z.boolean(),
  mentionable: z.boolean(),
  /** Bitfield de permissões como string (BigInt serializado). */
  permissions: z.string(),
  memberCount: z.number().int().min(0).optional(),
});
export type GuildRoleSummary = z.infer<typeof GuildRoleSummarySchema>;

export const AuditLogQuerySchema = z.object({
  /** `AuditLogEvent` numérico do Discord. */
  type: z.coerce.number().int().optional(),
  limit: limitQuery(100, 50),
  before: SnowflakeSchema.optional(),
});
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;

export const AuditLogEntrySummarySchema = z.object({
  id: SnowflakeSchema,
  /** `AuditLogEvent` numérico do Discord. */
  actionType: z.number().int(),
  targetId: SnowflakeSchema.nullable(),
  executor: z
    .object({ id: SnowflakeSchema, username: z.string(), avatarUrl: z.url().nullable() })
    .nullable(),
  reason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  changes: z.array(
    z.object({ key: z.string(), old: z.string().nullable(), new: z.string().nullable() }),
  ),
});
export type AuditLogEntrySummary = z.infer<typeof AuditLogEntrySummarySchema>;
