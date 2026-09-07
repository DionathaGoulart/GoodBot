import { z } from 'zod';

import { limitQuery } from './common';
import { actorFields } from './roles';
import { SnowflakeSchema, emptyToNull } from '../config/common';

/** Limites do Discord para os campos do servidor. */
export const MIN_GUILD_NAME_LENGTH = 2;
export const MAX_GUILD_NAME_LENGTH = 100;
export const MAX_GUILD_DESCRIPTION_LENGTH = 120;

/** `GuildVerificationLevel` do Discord, com o rótulo que o painel mostra. */
export const VERIFICATION_LEVELS = [
  { value: 0, label: 'NENHUM', hint: 'Qualquer um fala.' },
  { value: 1, label: 'BAIXO', hint: 'E-mail verificado.' },
  { value: 2, label: 'MÉDIO', hint: 'Conta com mais de 5 minutos.' },
  { value: 3, label: 'ALTO', hint: 'No servidor há mais de 10 minutos.' },
  { value: 4, label: 'MUITO ALTO', hint: 'Telefone verificado.' },
] as const;

export const VerificationLevelSchema = z.number().int().min(0).max(4);

/** Os únicos `afk_timeout` que o Discord aceita, em segundos. */
export const AFK_TIMEOUTS = [60, 300, 900, 1800, 3600] as const;
export const AfkTimeoutSchema = z
  .number()
  .int()
  .refine((value) => (AFK_TIMEOUTS as readonly number[]).includes(value), {
    message: 'Tempo de AFK inválido',
  });

/** Formatos que o Discord aceita para ícone e banner. */
export const GUILD_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** Teto por imagem, já descontada a base64 — é o limite do Discord. */
export const MAX_GUILD_IMAGE_BYTES = 8 * 1024 * 1024;

export type ImageRejection = 'format' | 'mime' | 'size';

export interface ParsedImageDataUrl {
  mime: string;
  /** Tamanho do binário depois de decodificar a base64. */
  bytes: number;
  animated: boolean;
}

const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;

/** Quantos bytes viram de uma base64 sem decodificar nada (`4n → 3n`). */
function base64Bytes(payload: string): number {
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

/** Formatos e teto aceitos por um campo de imagem. */
export interface ImageDataUrlLimits {
  mimeTypes: readonly string[];
  maxBytes: number;
}

/**
 * Valida uma imagem que chegou como data URL. Roda no painel (antes de subir),
 * na server action e na rota do bot — é a mesma função nos três, então o que o
 * navegador aceita é exatamente o que o Discord vai receber.
 *
 * Os limites são parâmetro porque emoji (256 KB) e sticker (512 KB) são bem
 * mais apertados que o ícone do servidor (Etapa 25); sem argumento, valem os
 * do servidor.
 */
export function parseImageDataUrl(
  value: string,
  limits: ImageDataUrlLimits = {
    mimeTypes: GUILD_IMAGE_MIME_TYPES,
    maxBytes: MAX_GUILD_IMAGE_BYTES,
  },
): { ok: true; image: ParsedImageDataUrl } | { ok: false; reason: ImageRejection } {
  const match = DATA_URL.exec(value);
  if (!match?.[1] || !match[2]) return { ok: false, reason: 'format' };

  const mime = match[1];
  if (!limits.mimeTypes.includes(mime)) return { ok: false, reason: 'mime' };

  const bytes = base64Bytes(match[2]);
  if (bytes <= 0) return { ok: false, reason: 'format' };
  if (bytes > limits.maxBytes) return { ok: false, reason: 'size' };

  return { ok: true, image: { mime, bytes, animated: mime === 'image/gif' } };
}

export const IMAGE_REJECTION_MESSAGE: Record<ImageRejection, string> = {
  format: 'A imagem não chegou num formato que o painel entenda.',
  mime: 'Use PNG, JPEG, GIF ou WEBP.',
  size: 'A imagem passa de 8 MB, o teto do Discord.',
};

/** Data URL de imagem, validada por tipo e por tamanho. */
export const GuildImageSchema = z.string().superRefine((value, ctx) => {
  const parsed = parseImageDataUrl(value);
  if (parsed.ok) return;
  ctx.addIssue({ code: 'custom', message: IMAGE_REJECTION_MESSAGE[parsed.reason] });
});

/**
 * O que o servidor precisa ter para cada campo existir. O Discord recusa esses
 * campos com um 400 genérico, então o painel checa antes e escreve o motivo.
 */
export const GUILD_FEATURE_GATES = {
  banner: { feature: 'BANNER', label: 'Banner do servidor', requirement: 'Impulso nível 2' },
  animatedIcon: { feature: 'ANIMATED_ICON', label: 'Ícone animado', requirement: 'Impulso nível 1' },
  splash: { feature: 'INVITE_SPLASH', label: 'Fundo do convite', requirement: 'Impulso nível 1' },
  description: {
    feature: 'COMMUNITY',
    label: 'Descrição do servidor',
    requirement: 'servidor de Comunidade',
  },
} as const;

export type GuildFeatureGate = keyof typeof GUILD_FEATURE_GATES;
export const GUILD_FEATURE_GATE_NAMES = Object.keys(GUILD_FEATURE_GATES) as GuildFeatureGate[];

export interface GateVerdict {
  allowed: boolean;
  /** `null` quando liberado; em português quando não. */
  reason: string | null;
  /** A feature que falta, para o log e para a mensagem da API. */
  feature: string;
}

export function guildGate(features: readonly string[], gate: GuildFeatureGate): GateVerdict {
  const { feature, label, requirement } = GUILD_FEATURE_GATES[gate];
  if (features.includes(feature)) return { allowed: true, reason: null, feature };
  return {
    allowed: false,
    feature,
    reason: `${label} exige ${requirement} (recurso ${feature}).`,
  };
}

export function guildGates(features: readonly string[]): Record<GuildFeatureGate, GateVerdict> {
  return Object.fromEntries(
    GUILD_FEATURE_GATE_NAMES.map((gate) => [gate, guildGate(features, gate)]),
  ) as Record<GuildFeatureGate, GateVerdict>;
}

/** As permissões do bot que esta tela precisa (PRD §10). */
export const GuildBotPermissionsSchema = z.object({
  manageGuild: z.boolean(),
  banMembers: z.boolean(),
  viewAuditLog: z.boolean(),
});
export type GuildBotPermissions = z.infer<typeof GuildBotPermissionsSchema>;

/**
 * O servidor como o Discord o guarda — nome, imagens, canais de sistema. Não
 * confundir com `GuildSettingsSchema` (`config/guild-settings`), que é a
 * configuração do CoBot para a guild.
 */
export const GuildProfileSchema = z.object({
  id: SnowflakeSchema,
  name: z.string(),
  description: z.string().nullable(),
  iconUrl: z.url().nullable(),
  bannerUrl: z.url().nullable(),
  verificationLevel: VerificationLevelSchema,
  systemChannelId: SnowflakeSchema.nullable(),
  afkChannelId: SnowflakeSchema.nullable(),
  afkTimeout: z.number().int(),
  ownerId: SnowflakeSchema,
  memberCount: z.number().int().min(0),
  /** 0–3; o painel usa para explicar o que falta liberar. */
  premiumTier: z.number().int().min(0).max(3),
  premiumSubscriptionCount: z.number().int().min(0),
  features: z.array(z.string()),
  permissions: GuildBotPermissionsSchema,
});
export type GuildProfile = z.infer<typeof GuildProfileSchema>;

/**
 * O corpo do `PATCH /guild`. Ícone e banner são opcionais em três estados:
 * ausente = não mexer, `null` = remover, data URL = trocar.
 */
export const GuildSettingsInputSchema = z.object({
  ...actorFields,
  name: z.string().trim().min(MIN_GUILD_NAME_LENGTH).max(MAX_GUILD_NAME_LENGTH),
  description: emptyToNull(z.string().trim().max(MAX_GUILD_DESCRIPTION_LENGTH)),
  verificationLevel: VerificationLevelSchema,
  systemChannelId: emptyToNull(SnowflakeSchema),
  afkChannelId: emptyToNull(SnowflakeSchema),
  afkTimeout: AfkTimeoutSchema,
  icon: GuildImageSchema.nullable().optional(),
  banner: GuildImageSchema.nullable().optional(),
});
export type GuildSettingsInput = z.infer<typeof GuildSettingsInputSchema>;

/**
 * Recusa, antes de qualquer chamada ao Discord, o que este servidor não
 * suporta. Devolve as mensagens em português, uma por campo bloqueado.
 */
export function guildSettingsBlockers(
  input: Pick<GuildSettingsInput, 'banner' | 'icon' | 'description'>,
  features: readonly string[],
): { field: 'banner' | 'icon' | 'description'; message: string }[] {
  const blockers: { field: 'banner' | 'icon' | 'description'; message: string }[] = [];
  const push = (field: 'banner' | 'icon' | 'description', gate: GuildFeatureGate) => {
    const verdict = guildGate(features, gate);
    if (!verdict.allowed && verdict.reason) blockers.push({ field, message: verdict.reason });
  };

  if (input.banner) push('banner', 'banner');

  const icon = input.icon ? parseImageDataUrl(input.icon) : null;
  if (icon?.ok && icon.image.animated) push('icon', 'animatedIcon');
  if (input.description) push('description', 'description');
  return blockers;
}

// ── banidos ────────────────────────────────────────────────────────────────

/** Página de banidos do Discord: cursor `after` por ID de usuário. */
export const MAX_BAN_PAGE = 1000;

export const BanListQuerySchema = z.object({
  /** ID, nome de usuário ou pedaço do motivo. */
  q: z.string().trim().max(100).default(''),
  limit: limitQuery(MAX_BAN_PAGE, 100),
  after: SnowflakeSchema.optional(),
});
export type BanListQuery = z.infer<typeof BanListQuerySchema>;

export const GuildBanSummarySchema = z.object({
  user: z.object({
    id: SnowflakeSchema,
    username: z.string(),
    avatarUrl: z.url().nullable(),
    bot: z.boolean(),
  }),
  reason: z.string().nullable(),
  /** Quem baniu, quando o audit log do Discord ainda tem a entrada. */
  executor: z
    .object({ id: SnowflakeSchema, username: z.string(), avatarUrl: z.url().nullable() })
    .nullable(),
  bannedAt: z.iso.datetime().nullable(),
});
export type GuildBanSummary = z.infer<typeof GuildBanSummarySchema>;

export const GuildBanPageSchema = z.object({
  bans: z.array(GuildBanSummarySchema),
  /** ID para o `after` da próxima página; `null` no fim da lista. */
  nextCursor: SnowflakeSchema.nullable(),
  /** `false` quando o bot não tem `ViewAuditLog` e a coluna "por" fica vazia. */
  executorsResolved: z.boolean(),
});
export type GuildBanPage = z.infer<typeof GuildBanPageSchema>;
