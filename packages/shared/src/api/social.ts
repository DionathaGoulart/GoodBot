import { z } from 'zod';

import { SnowflakeSchema } from '../config/common';
import { SocialKindSchema, SocialPlatformSchema, YOUTUBE_CHANNEL_ID_RE } from '../config/social';
import { MessageTemplateSchema } from '../templates';

/**
 * Uma conta como a API devolve: o que o painel mandou mais o estado que só o
 * bot conhece (última checagem, falhas, pausa automática e o último erro).
 */
export const SocialAccountSummarySchema = z.object({
  id: z.string(),
  platform: SocialPlatformSchema,
  externalId: z.string(),
  handle: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  discordChannelId: SnowflakeSchema,
  kinds: z.array(SocialKindSchema),
  template: MessageTemplateSchema,
  mentionRoleIds: z.array(SnowflakeSchema),
  liveMentionRoleIds: z.array(SnowflakeSchema),
  /** `false` só por decisão humana; o bot nunca desliga uma conta sozinho. */
  enabled: z.boolean(),
  /** ISO 8601; `null` enquanto o job não passou por ela. */
  lastCheckedAt: z.string().nullable(),
  failureCount: z.number().int(),
  /**
   * ISO 8601 de até quando o bot deixou a conta em pausa por falhas seguidas;
   * `null` = rodando normalmente. Passada a hora, o job tenta de novo.
   */
  pausedUntil: z.string().nullable(),
  /** Último erro da sequência de falhas; some no primeiro sucesso. */
  disabledReason: z.string().nullable(),
  createdAt: z.string(),
});
export type SocialAccountSummary = z.infer<typeof SocialAccountSummarySchema>;

export const SocialOverviewSchema = z.object({
  accounts: z.array(SocialAccountSummarySchema),
});
export type SocialOverview = z.infer<typeof SocialOverviewSchema>;

/**
 * `POST /social/resolve` — o painel manda o que o usuário digitou (URL da barra
 * de endereços, `@handle` ou `UC…`) e o bot devolve o canal de verdade. É o bot
 * quem fala com o YouTube, então é ele quem sabe se o canal existe.
 */
export const SocialResolveInputSchema = z.object({
  input: z.string().trim().min(1, 'Cole a URL, o @handle ou o ID do canal.').max(256),
});
export type SocialResolveInput = z.infer<typeof SocialResolveInputSchema>;

export const SocialResolveResultSchema = z.object({
  channelId: z.string().regex(YOUTUBE_CHANNEL_ID_RE),
  title: z.string().nullable(),
  handle: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type SocialResolveResult = z.infer<typeof SocialResolveResultSchema>;

/** `POST /social/:id/test` — dispara um anúncio de mentira no canal da conta. */
export const SocialTestResultSchema = z.object({
  channelId: SnowflakeSchema,
  messageId: z.string(),
});
export type SocialTestResult = z.infer<typeof SocialTestResultSchema>;
