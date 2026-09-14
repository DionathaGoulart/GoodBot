import { z } from 'zod';

import { SnowflakeSchema } from '../config/common';
import { SquadAvailabilitySchema, SquadGameFieldSchema, SquadNameSchema } from '../config/squads';
import {
  MAX_REASON_LENGTH,
  MAX_SQUAD_SIZE,
  MIN_SQUAD_SIZE,
  SQUAD_BLOCKS,
  SQUAD_DAYS,
  SQUAD_STATUSES,
} from '../constants';
import { MANUAL_MATCH_ISSUE_CODES } from '../squads/manual';

/** Parâmetro `:squadId` das rotas de um squad. */
export const SquadIdParamSchema = z.object({ squadId: z.uuid() });
export type SquadIdParam = z.infer<typeof SquadIdParamSchema>;

/** Parâmetro `:gameId` das rotas de um jogo. */
export const SquadGameIdParamSchema = z.object({ gameId: z.uuid() });
export type SquadGameIdParam = z.infer<typeof SquadGameIdParamSchema>;

/** Um jogo como a API devolve (linha de `squad_games`). */
export const SquadGameSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  squadSize: z.number().int(),
  enabled: z.boolean(),
  fields: z.array(SquadGameFieldSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SquadGameSummary = z.infer<typeof SquadGameSummarySchema>;

/** Um squad como a API devolve: a linha de `squads` com os membros. */
export const SquadSummarySchema = z.object({
  id: z.string(),
  gameId: z.string(),
  name: z.string(),
  memberIds: z.array(SnowflakeSchema),
  /** Janela semanal fixa: dia (0 = domingo) e índice da faixa. */
  day: z
    .number()
    .int()
    .min(0)
    .max(SQUAD_DAYS - 1),
  block: z
    .number()
    .int()
    .min(0)
    .max(SQUAD_BLOCKS.length - 1),
  status: z.enum(SQUAD_STATUSES),
  /** `null` = o canal ainda está sendo criado ou a criação falhou. */
  textChannelId: SnowflakeSchema.nullable(),
  /** `null` = o pool estava cheio e o squad está sem sala reservada. */
  voiceChannelId: SnowflakeSchema.nullable(),
  /** ISO 8601 da última sessão com alguém presente ou com "vou"; `null` = nunca. */
  lastConfirmedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type SquadSummary = z.infer<typeof SquadSummarySchema>;

/** Uma proposta ainda aberta (sem `closed_at`). */
export const SquadProposalSummarySchema = z.object({
  id: z.string(),
  gameId: z.string(),
  /** A turma proposta; é o que o cooldown de dupla consulta. */
  userIds: z.array(SnowflakeSchema),
  acceptedIds: z.array(SnowflakeSchema),
  declinedIds: z.array(SnowflakeSchema),
  /** Preenchido no primeiro aceite. */
  squadId: z.string().nullable(),
  threadId: SnowflakeSchema,
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type SquadProposalSummary = z.infer<typeof SquadProposalSummarySchema>;

/** Canais da guild contra o teto do Discord: cada squad gasta um. */
export const SquadChannelUsageSchema = z.object({
  used: z.number().int().min(0),
  limit: z.number().int().positive(),
});
export type SquadChannelUsage = z.infer<typeof SquadChannelUsageSchema>;

/** `GET /guilds/:id/squads/overview`: o que as abas do painel mostram. */
export const SquadOverviewSchema = z.object({
  games: z.array(SquadGameSummarySchema),
  squads: z.array(SquadSummarySchema),
  openProposals: z.array(SquadProposalSummarySchema),
  /** `gameId → perfis procurando`; jogo sem ninguém procurando pode faltar. */
  searchingCount: z.record(z.string(), z.number().int().min(0)),
  channels: SquadChannelUsageSchema,
});
export type SquadOverview = z.infer<typeof SquadOverviewSchema>;

/** `POST /guilds/:id/squads/search-message`: publica ou reposta a mensagem fixa. Só admin. */
export const PostSquadSearchMessageInputSchema = z.object({
  actorId: SnowflakeSchema,
  /** Sem canal, usa o `searchChannelId` do config. */
  channelId: SnowflakeSchema.optional(),
});
export type PostSquadSearchMessageInput = z.infer<typeof PostSquadSearchMessageInputSchema>;

export const PostSquadSearchMessageResultSchema = z.object({
  channelId: SnowflakeSchema,
  messageId: SnowflakeSchema,
});
export type PostSquadSearchMessageResult = z.infer<typeof PostSquadSearchMessageResultSchema>;

/**
 * `POST /guilds/:id/squads/:squadId/archive`: arquivar pelo painel (mod ou
 * acima). Responde com o `SquadSummary` atualizado.
 */
export const ArchiveSquadInputSchema = z.object({
  actorId: SnowflakeSchema,
  reason: z.string().trim().max(MAX_REASON_LENGTH).nullable().default(null),
});
export type ArchiveSquadInput = z.infer<typeof ArchiveSquadInputSchema>;

/** `POST /guilds/:id/squads/:squadId/rename`. Responde com o `SquadSummary` atualizado. */
export const RenameSquadInputSchema = z.object({
  actorId: SnowflakeSchema,
  name: SquadNameSchema,
});
export type RenameSquadInput = z.infer<typeof RenameSquadInputSchema>;

/** `POST /guilds/:id/squads/games/:gameId/match`: roda o matcher agora. Só admin. */
export const RunSquadMatchInputSchema = z.object({ actorId: SnowflakeSchema });
export type RunSquadMatchInput = z.infer<typeof RunSquadMatchInputSchema>;

export const RunSquadMatchResultSchema = z.object({
  /** Propostas novas abertas nesta passada. */
  proposals: z.number().int().min(0),
  /** Pedidos de entrada criados em squads `open` compatíveis. */
  joinRequests: z.number().int().min(0),
});
export type RunSquadMatchResult = z.infer<typeof RunSquadMatchResultSchema>;

// ── jogadores: match manual e gestão pelo painel ────────────────────────────

/** Uma célula da grade: dia (0 = domingo) e índice da faixa. */
export const SquadCellSchema = z.object({
  day: z
    .number()
    .int()
    .min(0)
    .max(SQUAD_DAYS - 1),
  block: z
    .number()
    .int()
    .min(0)
    .max(SQUAD_BLOCKS.length - 1),
});

const uniqueIds = (ids: readonly string[]) => new Set(ids).size === ids.length;

/** A turma escolhida pelo admin, sem repetição. */
export const PickedUserIdsSchema = z
  .array(SnowflakeSchema)
  .min(MIN_SQUAD_SIZE, 'Escolha pelo menos duas pessoas.')
  .max(MAX_SQUAD_SIZE, `Escolha no máximo ${String(MAX_SQUAD_SIZE)} pessoas.`)
  .refine(uniqueIds, 'Pessoa repetida na seleção.');

/** As `key`s dos avisos que o admin leu e aceitou. */
export const ConfirmedWarningsSchema = z.array(z.string().max(200)).max(200).default([]);

export const SquadManualIssueSchema = z.object({
  /** Estável entre revisões; é o que `confirmedWarnings` devolve. */
  key: z.string(),
  code: z.enum(MANUAL_MATCH_ISSUE_CODES),
  severity: z.enum(['block', 'warning']),
  userIds: z.array(SnowflakeSchema),
  /** Só em `HARD_MISMATCH`: os campos que não batem. */
  fieldKeys: z.array(z.string()).optional(),
});
export type SquadManualIssue = z.infer<typeof SquadManualIssueSchema>;

export const SquadManualPairSchema = z.object({
  userIds: z.tuple([SnowflakeSchema, SnowflakeSchema]),
  score: z.number().int().min(0),
  hardOk: z.boolean(),
  commonCells: z.number().int().min(0),
  cooldown: z.boolean(),
  hardConflicts: z.array(z.string()),
});
export type SquadManualPair = z.infer<typeof SquadManualPairSchema>;

/** A revisão de uma turma escolhida à mão, calculada pelo bot com dados frescos. */
export const SquadManualCheckSchema = z.object({
  gameId: z.string(),
  userIds: z.array(SnowflakeSchema),
  pairs: z.array(SquadManualPairSchema),
  score: z.number().int().min(0),
  commonMask: SquadAvailabilitySchema,
  slot: SquadCellSchema.nullable(),
  blocks: z.array(SquadManualIssueSchema),
  warnings: z.array(SquadManualIssueSchema),
});
export type SquadManualCheck = z.infer<typeof SquadManualCheckSchema>;

/** `POST /guilds/:id/squads/games/:gameId/manual/check`: revisa sem escrever nada. Só admin. */
export const SquadManualCheckInputSchema = z.object({
  actorId: SnowflakeSchema,
  userIds: PickedUserIdsSchema,
});
export type SquadManualCheckInput = z.infer<typeof SquadManualCheckInputSchema>;

/**
 * `POST /guilds/:id/squads/games/:gameId/manual/propose`: abre a proposta com a
 * turma. Passa só se `confirmedWarnings` cobre todos os avisos recalculados.
 */
export const ProposeSquadManuallyInputSchema = SquadManualCheckInputSchema.extend({
  confirmedWarnings: ConfirmedWarningsSchema,
});
export type ProposeSquadManuallyInput = z.infer<typeof ProposeSquadManuallyInputSchema>;

export const SquadManualProposalResultSchema = z.object({
  proposal: SquadProposalSummarySchema,
  check: SquadManualCheckSchema,
});
export type SquadManualProposalResult = z.infer<typeof SquadManualProposalResultSchema>;
