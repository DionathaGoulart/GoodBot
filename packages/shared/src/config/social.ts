import { z } from 'zod';

import {
  SOCIAL_DEFAULT_POLL_SECONDS,
  SOCIAL_KINDS,
  SOCIAL_MAX_POLL_SECONDS,
  SOCIAL_MIN_POLL_SECONDS,
  SOCIAL_PLATFORM,
} from '../constants';
import { MessageTemplateSchema, type MessageTemplate } from '../templates';
import { emptyToNull, moduleConfigBase, NullableSnowflakeSchema, SnowflakeSchema } from './common';

/**
 * Uma plataforma só. O enum do Postgres ainda tem quatro valores (v1), mas
 * nada além do YouTube passa pela validação desde a v2 (PRD §5.8).
 */
export const SocialPlatformSchema = z.literal(SOCIAL_PLATFORM);
export const SocialKindSchema = z.enum(SOCIAL_KINDS);

/**
 * O que o cadastro aceita no lugar do `UC…`. Ninguém sabe o ID do próprio canal
 * de cabeça; o que a pessoa tem na mão é a URL da barra de endereços ou o
 * `@handle`. Quem traduz é o bot (`POST /social/resolve`), que também recusa na
 * hora o canal que não existe — por isso o schema aqui só guarda o resultado.
 */
export const YOUTUBE_CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

/**
 * Template padrão de uma conta nova. `{headline}` existe justamente porque um
 * texto só precisa servir aos três tipos: "publicou um vídeo novo", "publicou
 * um short", "está ao vivo". `{thumbnail}` não aparece de propósito — a capa
 * entra como imagem do embed, não como texto.
 */
export const SOCIAL_DEFAULT_TEMPLATE: MessageTemplate = MessageTemplateSchema.parse({
  content: '{author} {headline}',
  embed: { title: '{title}', url: '{url}', timestamp: true },
});

/**
 * Uma conta observada (linha de `social_accounts`). É o corpo que o painel e o
 * `/social add` mandam; o bot e o painel validam com este mesmo schema.
 */
export const SocialAccountInputSchema = z.object({
  platform: SocialPlatformSchema.default(SOCIAL_PLATFORM),
  /** `channel_id` do YouTube, já resolvido a partir da URL ou do `@handle`. */
  externalId: z
    .string()
    .trim()
    .regex(YOUTUBE_CHANNEL_ID_RE, 'O ID de um canal do YouTube começa com UC e tem 24 caracteres.'),
  /** `@handle` e nome vêm da resolução; são só exibição. */
  handle: emptyToNull(z.string().trim().max(64)),
  displayName: emptyToNull(z.string().trim().max(80)),
  /** Avatar do canal, para a lista do painel. */
  avatarUrl: emptyToNull(z.url({ protocol: /^https$/ }).max(512)),
  discordChannelId: SnowflakeSchema,
  kinds: z
    .array(SocialKindSchema)
    .min(1, 'Escolha ao menos um tipo de publicação')
    .transform((kinds) => [...new Set(kinds)]),
  template: MessageTemplateSchema,
  mentionRoleId: NullableSnowflakeSchema,
  enabled: z.boolean().default(true),
});
export type SocialAccountInput = z.infer<typeof SocialAccountInputSchema>;

/** Config do módulo (`module_configs.config`, jsonb). */
export const SocialConfigSchema = z.object({
  ...moduleConfigBase,
  /**
   * Intervalo do laço inteiro: uma passada percorre todas as contas ligadas.
   * Não há intervalo por conta — com o teto de 20 contas por servidor a passada
   * inteira cabe folgada dentro do menor intervalo.
   */
  pollIntervalSeconds: z
    .number()
    .int()
    .min(SOCIAL_MIN_POLL_SECONDS)
    .max(SOCIAL_MAX_POLL_SECONDS)
    .default(SOCIAL_DEFAULT_POLL_SECONDS),
});
export type SocialConfig = z.infer<typeof SocialConfigSchema>;
export const DEFAULT_SOCIAL_CONFIG: SocialConfig = SocialConfigSchema.parse({});
