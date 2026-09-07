import { z } from 'zod';

import {
  MAX_SOCIAL_ACCOUNTS,
  SOCIAL_DEFAULT_POLL_SECONDS,
  SOCIAL_KINDS,
  SOCIAL_KINDS_BY_PLATFORM,
  SOCIAL_MAX_POLL_SECONDS,
  SOCIAL_MIN_POLL_SECONDS,
  SOCIAL_PLATFORMS,
  type SocialKind,
  type SocialPlatform,
} from '../constants';
import { MessageTemplateSchema, type MessageTemplate } from '../templates';
import { emptyToNull, moduleConfigBase, NullableSnowflakeSchema, SnowflakeSchema } from './common';

export const SocialPlatformSchema = z.enum(SOCIAL_PLATFORMS);
export const SocialKindSchema = z.enum(SOCIAL_KINDS);

/**
 * Como cada plataforma nomeia a conta que o bot observa. O painel mostra estas
 * dicas no formulário, e o schema recusa o que não tem cara do formato certo —
 * um `@handle` colado no lugar do `channel_id` falharia só no primeiro ciclo,
 * horas depois, sem ninguém entender o porquê.
 */
export const SOCIAL_EXTERNAL_ID = {
  youtube: {
    label: 'ID do canal',
    hint: 'Começa com `UC` e tem 24 caracteres. Está em youtube.com/channel/UC…',
    pattern: /^UC[A-Za-z0-9_-]{22}$/,
    message: 'O ID de um canal do YouTube começa com UC e tem 24 caracteres.',
  },
  twitch: {
    label: 'Login do canal',
    hint: 'O nome que aparece em twitch.tv/<nome>, sem arroba.',
    pattern: /^[A-Za-z0-9_]{3,25}$/,
    message: 'O login da Twitch tem de 3 a 25 letras, números ou _.',
  },
  instagram: {
    label: 'IG User ID',
    hint: 'O ID numérico da conta Business/Creator (o mesmo de IG_USER_ID).',
    pattern: /^\d{5,25}$/,
    message: 'O IG User ID é só dígitos.',
  },
  tiktok: {
    label: 'Usuário',
    hint: 'O @ do perfil, sem arroba.',
    pattern: /^[A-Za-z0-9._]{2,24}$/,
    message: 'O usuário do TikTok tem de 2 a 24 letras, números, ponto ou _.',
  },
} as const satisfies Record<
  SocialPlatform,
  { label: string; hint: string; pattern: RegExp; message: string }
>;

/**
 * Template padrão sugerido ao criar uma conta. `{thumbnail}` não aparece aqui
 * de propósito: a capa do vídeo entra como imagem do embed, não como texto.
 */
export const SOCIAL_DEFAULT_TEMPLATES: Record<SocialPlatform, MessageTemplate> = {
  youtube: MessageTemplateSchema.parse({
    content: '{author} publicou: {url}',
    embed: { title: '{title}', description: '{url}', timestamp: true },
  }),
  twitch: MessageTemplateSchema.parse({
    content: '{author} está ao vivo!',
    embed: { title: '{title}', description: '{url}', timestamp: true },
  }),
  instagram: MessageTemplateSchema.parse({
    content: '{author} publicou no Instagram: {url}',
  }),
  tiktok: MessageTemplateSchema.parse({
    content: '{author} publicou no TikTok: {url}',
  }),
};

/**
 * Uma conta observada (linha de `social_accounts`). É o corpo que o painel e o
 * `/social add` mandam; o bot e o painel validam com este mesmo schema.
 */
export const SocialAccountInputSchema = z
  .object({
    platform: SocialPlatformSchema,
    /** `channel_id`, `user_login` ou `ig_user_id`, conforme a plataforma. */
    externalId: z.string().trim().min(1).max(128),
    /** `@handle` só para exibição; nada depende dele. */
    handle: emptyToNull(z.string().trim().max(64)),
    displayName: emptyToNull(z.string().trim().max(80)),
    discordChannelId: SnowflakeSchema,
    kinds: z
      .array(SocialKindSchema)
      .min(1, 'Escolha ao menos um tipo de publicação')
      .transform((kinds) => [...new Set(kinds)]),
    template: MessageTemplateSchema,
    mentionRoleId: NullableSnowflakeSchema,
    enabled: z.boolean().default(true),
    pollIntervalSeconds: z
      .number()
      .int()
      .min(SOCIAL_MIN_POLL_SECONDS)
      .max(SOCIAL_MAX_POLL_SECONDS)
      .default(SOCIAL_DEFAULT_POLL_SECONDS),
  })
  .superRefine((account, ctx) => {
    const format = SOCIAL_EXTERNAL_ID[account.platform];
    if (!format.pattern.test(account.externalId)) {
      ctx.addIssue({ code: 'custom', path: ['externalId'], message: format.message });
    }

    const allowed: readonly SocialKind[] = SOCIAL_KINDS_BY_PLATFORM[account.platform];
    const invalid = account.kinds.filter((kind) => !allowed.includes(kind));
    if (invalid.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['kinds'],
        message: `${account.platform} só anuncia: ${allowed.join(', ')}.`,
      });
    }
  });
export type SocialAccountInput = z.infer<typeof SocialAccountInputSchema>;

/** Config do módulo (`module_configs.config`, jsonb). */
export const SocialConfigSchema = z.object({
  ...moduleConfigBase,
  /** Teto de contas por servidor: cada uma é uma chamada HTTP por ciclo. */
  maxAccounts: z.number().int().min(1).max(MAX_SOCIAL_ACCOUNTS).default(MAX_SOCIAL_ACCOUNTS),
  /** Intervalo sugerido ao criar uma conta nova. */
  defaultPollIntervalSeconds: z
    .number()
    .int()
    .min(SOCIAL_MIN_POLL_SECONDS)
    .max(SOCIAL_MAX_POLL_SECONDS)
    .default(SOCIAL_DEFAULT_POLL_SECONDS),
  /**
   * Anunciar o que já existia quando a conta foi criada. Desligado de
   * propósito: ligar despejaria o feed inteiro no canal de uma vez.
   */
  announceBacklog: z.boolean().default(false),
});
export type SocialConfig = z.infer<typeof SocialConfigSchema>;
export const DEFAULT_SOCIAL_CONFIG: SocialConfig = SocialConfigSchema.parse({});
