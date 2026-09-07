import { z } from 'zod';

import { actorFields } from './roles';
import { SnowflakeSchema } from '../config/common';

/**
 * Convites do servidor (PRD §6.3). O Discord aceita qualquer duração até uma
 * semana, mas a tela oferece a mesma lista que o cliente oficial — inventar
 * `4h37min` só serviria para ninguém conseguir ler a tabela depois.
 */
export const MAX_INVITE_AGE_SECONDS = 604_800;
export const MAX_INVITE_USES = 100;

export const INVITE_MAX_AGES = [0, 1800, 3600, 21_600, 43_200, 86_400, MAX_INVITE_AGE_SECONDS];

export const INVITE_MAX_AGE_LABEL: Record<number, string> = {
  0: 'NUNCA EXPIRA',
  1800: '30 MINUTOS',
  3600: '1 HORA',
  21_600: '6 HORAS',
  43_200: '12 HORAS',
  86_400: '1 DIA',
  604_800: '7 DIAS',
};

export const INVITE_MAX_USES_OPTIONS = [0, 1, 5, 10, 25, 50, MAX_INVITE_USES];

export const INVITE_MAX_USES_LABEL: Record<number, string> = {
  0: 'SEM LIMITE',
  1: '1 USO',
  5: '5 USOS',
  10: '10 USOS',
  25: '25 USOS',
  50: '50 USOS',
  100: '100 USOS',
};

/** `POST /guilds/:id/invites` — criar um convite pelo painel. */
export const CreateInviteInputSchema = z.object({
  ...actorFields,
  channelId: SnowflakeSchema,
  /** Segundos até expirar; `0` = nunca. */
  maxAge: z.number().int().min(0).max(MAX_INVITE_AGE_SECONDS).default(86_400),
  /** `0` = ilimitado. */
  maxUses: z.number().int().min(0).max(MAX_INVITE_USES).default(0),
  /** Quem entrar por ele é expulso ao desconectar, se não ganhar cargo. */
  temporary: z.boolean().default(false),
  /** `false` reaproveita um convite igual que já exista no canal. */
  unique: z.boolean().default(true),
});
export type CreateInviteInput = z.infer<typeof CreateInviteInputSchema>;

export const GuildInviteSummarySchema = z.object({
  code: z.string(),
  url: z.string(),
  channel: z.object({ id: SnowflakeSchema, name: z.string() }).nullable(),
  /** Quem criou; `null` em convite de vanity URL ou de integração. */
  inviter: z
    .object({ id: SnowflakeSchema, username: z.string(), avatarUrl: z.url().nullable() })
    .nullable(),
  uses: z.number().int().min(0),
  /** `0` = ilimitado. */
  maxUses: z.number().int().min(0),
  /** Segundos de validade; `0` = nunca expira. */
  maxAge: z.number().int().min(0),
  temporary: z.boolean(),
  createdAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
});
export type GuildInviteSummary = z.infer<typeof GuildInviteSummarySchema>;

export const GuildInviteListSchema = z.object({
  invites: z.array(GuildInviteSummarySchema),
  /** `false` quando falta `ManageGuild`: a tela explica em vez de sumir. */
  canManage: z.boolean(),
});
export type GuildInviteList = z.infer<typeof GuildInviteListSchema>;
