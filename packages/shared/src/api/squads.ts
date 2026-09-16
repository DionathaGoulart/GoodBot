import { z } from 'zod';

import { SnowflakeSchema } from '../config/common';
import {
  SquadAnswersSchema,
  SquadAvailabilitySchema,
  SquadGameFieldSchema,
  SquadNameSchema,
  SquadProfileInputStatusSchema,
} from '../config/squads';
import {
  MAX_REASON_LENGTH,
  MAX_SQUAD_SIZE,
  MIN_SQUAD_SIZE,
  SQUAD_BLOCKS,
  SQUAD_DAYS,
  SQUAD_PROFILE_STATUSES,
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

/** Uma jogatina marcada ou rolando, como o painel mostra na tabela de squads. */
export const SquadSessionSummarySchema = z.object({
  id: z.number().int().positive(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  /** Quantos votaram "vou". */
  goingCount: z.number().int().min(0),
  /** Já começou e ainda não acabou. */
  live: z.boolean(),
  /** Quem marcou; `null` nas jogatinas do agendamento semanal antigo. */
  createdBy: SnowflakeSchema.nullable(),
});
export type SquadSessionSummary = z.infer<typeof SquadSessionSummarySchema>;

/** Um squad como a API devolve: a linha de `squads` com os membros. */
export const SquadSummarySchema = z.object({
  id: z.string(),
  gameId: z.string(),
  name: z.string(),
  memberIds: z.array(SnowflakeSchema),
  status: z.enum(SQUAD_STATUSES),
  /** `null` = o canal ainda está sendo criado ou a criação falhou. */
  textChannelId: SnowflakeSchema.nullable(),
  /** `null` = o pool estava cheio e o squad está sem sala preferida. */
  voiceChannelId: SnowflakeSchema.nullable(),
  /** ISO 8601 do último sinal de vida (jogatina, "vou", presença); `null` = nunca. */
  lastConfirmedAt: z.iso.datetime().nullable(),
  /**
   * Jogatinas não canceladas que ainda não acabaram, da mais próxima para a
   * mais distante. Default vazio: um bot anterior à v1.6 não manda o campo.
   */
  upcomingSessions: z.array(SquadSessionSummarySchema).default([]),
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

/** Parâmetros das rotas de um perfil: o jogo e a pessoa. */
export const SquadProfileParamSchema = z.object({ gameId: z.uuid(), userId: SnowflakeSchema });
export type SquadProfileParam = z.infer<typeof SquadProfileParamSchema>;

/** Parâmetros das rotas de um membro de squad. */
export const SquadMemberParamSchema = z.object({ squadId: z.uuid(), userId: SnowflakeSchema });
export type SquadMemberParam = z.infer<typeof SquadMemberParamSchema>;

/**
 * Perfil como a API devolve. `answers` fica frouxo de propósito: resposta
 * gravada antes de o admin mudar os campos do jogo não pode quebrar a leitura.
 */
export const SquadProfileSummarySchema = z.object({
  userId: SnowflakeSchema,
  gameId: z.string(),
  status: z.enum(SQUAD_PROFILE_STATUSES),
  availability: SquadAvailabilitySchema,
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  lastMatchedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SquadProfileSummary = z.infer<typeof SquadProfileSummarySchema>;

const uniqueIds = (ids: readonly string[]) => new Set(ids).size === ids.length;

/** A turma escolhida pelo admin, sem repetição. */
export const PickedUserIdsSchema = z
  .array(SnowflakeSchema)
  .min(MIN_SQUAD_SIZE, 'Escolha pelo menos duas pessoas.')
  .max(MAX_SQUAD_SIZE, `Escolha no máximo ${String(MAX_SQUAD_SIZE)} pessoas.`)
  .refine(uniqueIds, 'Pessoa repetida na seleção.');

/** As `key`s dos avisos que o admin leu e aceitou. */
export const ConfirmedWarningsSchema = z.array(z.string().max(200)).max(200).default([]);

/** Motivo das ações de gestão: obrigatório porque vai na DM da pessoa e na auditoria. */
export const SquadAdminReasonSchema = z
  .string()
  .trim()
  .min(1, 'Escreva o motivo. Ele vai na DM da pessoa.')
  .max(MAX_REASON_LENGTH, `O motivo tem no máximo ${String(MAX_REASON_LENGTH)} caracteres.`);

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

/** A DM com o motivo chegou. `false` não é erro: a ação já valeu. */
const NotifiedSchema = z.boolean();

/** `POST /guilds/:id/squads/:squadId/members/:userId/remove`. Só admin; vale com o módulo desligado. */
export const RemoveSquadMemberInputSchema = z.object({
  actorId: SnowflakeSchema,
  reason: SquadAdminReasonSchema,
});
export type RemoveSquadMemberInput = z.infer<typeof RemoveSquadMemberInputSchema>;

export const RemoveSquadMemberResultSchema = z.object({
  squad: SquadSummarySchema,
  archived: z.boolean(),
  profileStatus: z.enum(SQUAD_PROFILE_STATUSES).nullable(),
  notified: NotifiedSchema,
});
export type RemoveSquadMemberResult = z.infer<typeof RemoveSquadMemberResultSchema>;

/** `POST /guilds/:id/squads/games/:gameId/profiles/:userId/status`: pausar ou retomar. Só admin. */
export const SetSquadProfileStatusInputSchema = z.object({
  actorId: SnowflakeSchema,
  status: SquadProfileInputStatusSchema,
  reason: SquadAdminReasonSchema,
});
export type SetSquadProfileStatusInput = z.infer<typeof SetSquadProfileStatusInputSchema>;

export const SquadProfileStatusResultSchema = z.object({
  profile: SquadProfileSummarySchema,
  /** O match que retomar dispara; `null` ao pausar ou quando ele falhou. */
  match: RunSquadMatchResultSchema.nullable(),
  notified: NotifiedSchema,
});
export type SquadProfileStatusResult = z.infer<typeof SquadProfileStatusResultSchema>;

/** `POST /guilds/:id/squads/games/:gameId/profiles/:userId/answers`. Só admin. */
export const EditSquadProfileAnswersInputSchema = z.object({
  actorId: SnowflakeSchema,
  answers: SquadAnswersSchema,
  reason: SquadAdminReasonSchema,
});
export type EditSquadProfileAnswersInput = z.infer<typeof EditSquadProfileAnswersInputSchema>;

export const SquadProfileAnswersResultSchema = z.object({
  profile: SquadProfileSummarySchema,
  notified: NotifiedSchema,
});
export type SquadProfileAnswersResult = z.infer<typeof SquadProfileAnswersResultSchema>;

/** `POST /guilds/:id/squads/games/:gameId/profiles/:userId/delete`. Só admin. */
export const DeleteSquadProfileInputSchema = RemoveSquadMemberInputSchema;
export type DeleteSquadProfileInput = z.infer<typeof DeleteSquadProfileInputSchema>;

export const DeleteSquadProfileResultSchema = z.object({
  deleted: SquadProfileSummarySchema,
  notified: NotifiedSchema,
});
export type DeleteSquadProfileResult = z.infer<typeof DeleteSquadProfileResultSchema>;
