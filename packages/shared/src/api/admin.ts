import { z } from 'zod';

import { SnowflakeSchema } from '../config/common';
import {
  BROADCAST_CONFIRMATION,
  GUILD_STATUSES,
  MAX_EMBED_DESCRIPTION_LENGTH,
  MAX_EMBED_TITLE_LENGTH,
  MAX_REASON_LENGTH,
} from '../constants';

/**
 * O painel do dono do bot (`admin.<domínio>`).
 *
 * Estas rotas são as únicas da API que **não** são de guild: quem decide se a
 * chamada vale não é o nível de alguém num servidor, é ser o dono do bot. O
 * Bearer continua provando que a chamada veio do painel, e o `actorId` continua
 * dizendo quem pediu — a diferença é o que ele é conferido contra
 * (`OWNER_DISCORD_ID`, e não a hierarquia de cargos de uma guild).
 */

/** Toda escrita do admin carrega quem pediu, como o resto da API. */
export const AdminActorSchema = z.object({ actorId: SnowflakeSchema });
export type AdminActor = z.infer<typeof AdminActorSchema>;

// ── servidores ───────────────────────────────────────────────────────────────

/**
 * O que o **bot** sabe de um servidor agora. O registro (status, quem
 * convidou, prazo da demo) fica de fora de propósito: ele vem do Postgres, que
 * o painel lê direto. Assim a fila de aprovação continua funcionando com o bot
 * fora do ar — aprovar é uma escrita no banco, e o bot a enxerga quando voltar.
 */
export const AdminGuildLiveSchema = z.object({
  id: SnowflakeSchema,
  name: z.string(),
  iconUrl: z.string().nullable(),
  memberCount: z.number().int().min(0),
  ownerId: SnowflakeSchema,
  /** `null` quando o dono não está no cache de membros. */
  ownerTag: z.string().nullable(),
  /** Quando o bot entrou; `null` no caso raro de o gateway não informar. */
  joinedAt: z.string().nullable(),
  /** O bot consegue falar em algum canal deste servidor? */
  canAnnounce: z.boolean(),
});
export type AdminGuildLive = z.infer<typeof AdminGuildLiveSchema>;

export const AdminGuildListSchema = z.object({
  guilds: z.array(AdminGuildLiveSchema),
  /** Guilds no cache do bot; é o mesmo que `guilds.length`, explícito. */
  cached: z.number().int().min(0),
});
export type AdminGuildList = z.infer<typeof AdminGuildListSchema>;

export const LeaveGuildInputSchema = AdminActorSchema.extend({
  reason: z.string().max(MAX_REASON_LENGTH).optional(),
  /** Avisar no servidor antes de sair. Desligado = sai calado. */
  announce: z.boolean().default(true),
});
export type LeaveGuildInput = z.infer<typeof LeaveGuildInputSchema>;

export const LeaveGuildResultSchema = z.object({
  guildId: SnowflakeSchema,
  name: z.string(),
  /** O aviso saiu? `false` quando não havia canal onde falar. */
  announced: z.boolean(),
});
export type LeaveGuildResult = z.infer<typeof LeaveGuildResultSchema>;

// ── broadcast ────────────────────────────────────────────────────────────────

/**
 * Aviso para todos os servidores atendidos.
 *
 * `confirm` não é enfeite de tela: a confirmação digitada precisa **chegar até
 * aqui**, senão ela seria só um obstáculo no navegador e qualquer chamada solta
 * com o token mandaria mensagem para gente que não é nossa. É irreversível — o
 * bot não apaga o que já publicou.
 */
export const BroadcastInputSchema = AdminActorSchema.extend({
  title: z.string().min(1).max(MAX_EMBED_TITLE_LENGTH),
  message: z.string().min(1).max(MAX_EMBED_DESCRIPTION_LENGTH),
  confirm: z.literal(BROADCAST_CONFIRMATION),
  /** Só descobre onde cairia, sem enviar nada. */
  dryRun: z.boolean().default(false),
});
export type BroadcastInput = z.infer<typeof BroadcastInputSchema>;

export const BroadcastTargetSchema = z.object({
  guildId: SnowflakeSchema,
  name: z.string(),
  /** Canal escolhido; `null` quando não há nenhum em que o bot possa falar. */
  channelId: SnowflakeSchema.nullable(),
  channelName: z.string().nullable(),
  /** No `dryRun` é sempre `false`; fora dele diz se a mensagem saiu. */
  delivered: z.boolean(),
  error: z.string().nullable(),
});
export type BroadcastTarget = z.infer<typeof BroadcastTargetSchema>;

export const BroadcastResultSchema = z.object({
  dryRun: z.boolean(),
  total: z.number().int().min(0),
  delivered: z.number().int().min(0),
  failed: z.number().int().min(0),
  targets: z.array(BroadcastTargetSchema),
});
export type BroadcastResult = z.infer<typeof BroadcastResultSchema>;

// ── manutenção ───────────────────────────────────────────────────────────────

/**
 * Modo manutenção: o bot fica no ar, responde `/health` e continua registrando
 * eventos, mas recusa **interação** com um aviso efêmero. É o que permite
 * mexer no banco sem que metade de um comando escreva no meio.
 *
 * O estado vive na tabela `meta` (e não numa variável do processo) porque um
 * deploy no meio da janela desligaria a manutenção sem ninguém pedir.
 */
export const MaintenanceStateSchema = z.object({
  enabled: z.boolean(),
  /** Texto mostrado a quem tentar usar o bot; `null` = o padrão do bot. */
  message: z.string().nullable(),
  since: z.string().nullable(),
  by: SnowflakeSchema.nullable(),
});
export type MaintenanceState = z.infer<typeof MaintenanceStateSchema>;

export const MaintenanceInputSchema = AdminActorSchema.extend({
  enabled: z.boolean(),
  message: z.string().max(MAX_EMBED_DESCRIPTION_LENGTH).nullable().default(null),
});
export type MaintenanceInput = z.infer<typeof MaintenanceInputSchema>;

// ── re-registro de comandos ──────────────────────────────────────────────────

/**
 * Força o `PUT` do manifesto de comandos no Discord.
 *
 * No boot o registro só acontece quando o hash do manifesto mudou; isto existe
 * para o caso em que o hash está certo e o Discord não — comando sumido do
 * cliente, guild que entrou durante uma falha de rede.
 */
export const ResyncCommandsInputSchema = AdminActorSchema.extend({
  /** Uma guild só; ausente = todas as atendidas. */
  guildId: SnowflakeSchema.optional(),
});
export type ResyncCommandsInput = z.infer<typeof ResyncCommandsInputSchema>;

export const ResyncCommandsResultSchema = z.object({
  /** Quantos comandos o manifesto tem. */
  count: z.number().int().min(0),
  guilds: z.array(
    z.object({
      guildId: SnowflakeSchema,
      name: z.string().nullable(),
      registered: z.boolean(),
      error: z.string().nullable(),
    }),
  ),
});
export type ResyncCommandsResult = z.infer<typeof ResyncCommandsResultSchema>;

// ── diagnóstico ──────────────────────────────────────────────────────────────

/**
 * Um erro recente do processo. O `/metrics` conta quantos houve; isto diz
 * **quais** — que é o que serve para decidir se vale abrir o log da VM.
 * Só a mensagem, nunca a stack: ela vai para o pino e fica lá.
 */
export const ErrorEntrySchema = z.object({
  at: z.string(),
  scope: z.string(),
  message: z.string(),
  /** Comando, evento ou `custom_id` em que aconteceu, quando dá para saber. */
  where: z.string().nullable(),
  guildId: SnowflakeSchema.nullable(),
});
export type ErrorEntry = z.infer<typeof ErrorEntrySchema>;

export const AdminDiagnosticsSchema = z.object({
  /** Do mais novo para o mais velho. */
  recent: z.array(ErrorEntrySchema),
  /** Total acumulado desde o boot, por escopo. */
  byScope: z.array(z.object({ scope: z.string(), count: z.number().int().min(0) })),
  /** Comandos executados até o fim desde o boot. */
  commandsTotal: z.number().int().min(0),
});
export type AdminDiagnostics = z.infer<typeof AdminDiagnosticsSchema>;

// ── reexport de conveniência ─────────────────────────────────────────────────

/** O enum de status, para o painel montar filtros sem duplicar a lista. */
export const GuildStatusSchema = z.enum(GUILD_STATUSES);
