import { z } from 'zod';

import { SnowflakeSchema } from '../config/common';
import { SocialKindSchema, SocialPlatformSchema } from '../config/social';
import { MessageTemplateSchema } from '../templates';

/**
 * Uma conta como a API devolve: o que o painel mandou mais o estado que só o
 * bot conhece (última checagem, falhas, motivo da desativação automática).
 */
export const SocialAccountSummarySchema = z.object({
  id: z.string(),
  platform: SocialPlatformSchema,
  externalId: z.string(),
  handle: z.string().nullable(),
  displayName: z.string().nullable(),
  discordChannelId: SnowflakeSchema,
  kinds: z.array(SocialKindSchema),
  template: MessageTemplateSchema,
  mentionRoleId: SnowflakeSchema.nullable(),
  enabled: z.boolean(),
  pollIntervalSeconds: z.number().int(),
  /** ISO 8601; `null` enquanto o job não passou por ela. */
  lastCheckedAt: z.string().nullable(),
  /** `external_id` da última publicação vista. */
  lastExternalId: z.string().nullable(),
  failureCount: z.number().int(),
  /** Preenchido quando o bot desligou a conta sozinho. */
  disabledReason: z.string().nullable(),
  createdAt: z.string(),
});
export type SocialAccountSummary = z.infer<typeof SocialAccountSummarySchema>;

/**
 * Estado de uma plataforma no processo do bot: sem `TWITCH_CLIENT_ID` a Twitch
 * não tem como funcionar, e o painel precisa dizer isso em vez de deixar o
 * usuário criar uma conta que nunca vai anunciar (PRD §5.8).
 */
export const SocialPlatformStatusSchema = z.object({
  platform: SocialPlatformSchema,
  available: z.boolean(),
  /** Motivo da indisponibilidade, em pt-BR, pronto para a tela. */
  reason: z.string().nullable(),
  /** Tipos que esta plataforma consegue anunciar agora. */
  kinds: z.array(SocialKindSchema),
});
export type SocialPlatformStatus = z.infer<typeof SocialPlatformStatusSchema>;

export const SocialOverviewSchema = z.object({
  accounts: z.array(SocialAccountSummarySchema),
  platforms: z.array(SocialPlatformStatusSchema),
});
export type SocialOverview = z.infer<typeof SocialOverviewSchema>;

/** `POST /social/:id/test` — dispara um anúncio de mentira no canal da conta. */
export const SocialTestResultSchema = z.object({
  channelId: SnowflakeSchema,
  messageId: z.string(),
});
export type SocialTestResult = z.infer<typeof SocialTestResultSchema>;
