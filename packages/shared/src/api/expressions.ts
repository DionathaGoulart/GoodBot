import { z } from 'zod';

import { IMAGE_REJECTION_MESSAGE, parseImageDataUrl } from './guild';
import { actorFields } from './roles';
import { SnowflakeSchema, emptyToNull } from '../config/common';

/**
 * Emojis e stickers (PRD §6.3). Os tetos são do Discord e mudam com o nível de
 * impulso; o painel recusa antes de subir porque um 400 do Discord no meio de
 * um upload de 256 KB não diz quantos slots sobraram.
 */
export const EMOJI_SLOTS_BY_TIER = [50, 100, 150, 250] as const;
export const STICKER_SLOTS_BY_TIER = [5, 15, 30, 60] as const;

export const MAX_EMOJI_BYTES = 256 * 1024;
export const MAX_STICKER_BYTES = 512 * 1024;

export const EMOJI_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const STICKER_MIME_TYPES = ['image/png', 'image/gif'];

export const MIN_EXPRESSION_NAME_LENGTH = 2;
export const MAX_EMOJI_NAME_LENGTH = 32;
export const MAX_STICKER_NAME_LENGTH = 30;
export const MAX_STICKER_DESCRIPTION_LENGTH = 100;
export const MAX_STICKER_TAGS_LENGTH = 200;

/** Nível de impulso fora de 0–3 vira o mais próximo em vez de explodir. */
function clampTier(tier: number): 0 | 1 | 2 | 3 {
  const clamped = Math.min(3, Math.max(0, Math.trunc(tier)));
  return clamped as 0 | 1 | 2 | 3;
}

/**
 * Slots de emoji **por pool**. O Discord conta estáticos e animados
 * separadamente: um servidor sem impulso tem 50 de cada, não 50 no total.
 */
export function emojiSlots(premiumTier: number): number {
  return EMOJI_SLOTS_BY_TIER[clampTier(premiumTier)];
}

export function stickerSlots(premiumTier: number): number {
  return STICKER_SLOTS_BY_TIER[clampTier(premiumTier)];
}

export interface SlotState {
  limit: number;
  used: number;
  remaining: number;
  full: boolean;
}

export function slotState(limit: number, used: number): SlotState {
  const remaining = Math.max(0, limit - used);
  return { limit, used, remaining, full: remaining === 0 };
}

/** O que a tela mostra em cima da grade e o que a rota checa antes de subir. */
export const ExpressionLimitsSchema = z.object({
  premiumTier: z.number().int().min(0).max(3),
  staticEmojis: z.number().int().min(0),
  animatedEmojis: z.number().int().min(0),
  stickers: z.number().int().min(0),
});
export type ExpressionLimits = z.infer<typeof ExpressionLimitsSchema>;

/** Quantos slots de emoji sobram no pool daquele tipo. */
export function emojiSlotState(limits: ExpressionLimits, animated: boolean): SlotState {
  return slotState(
    emojiSlots(limits.premiumTier),
    animated ? limits.animatedEmojis : limits.staticEmojis,
  );
}

export function stickerSlotState(limits: ExpressionLimits): SlotState {
  return slotState(stickerSlots(limits.premiumTier), limits.stickers);
}

/** A recusa com a contagem dentro — é isso que o usuário precisa ler. */
export function slotsFullMessage(kind: 'emoji-static' | 'emoji-animated' | 'sticker', state: SlotState): string {
  const what =
    kind === 'sticker'
      ? 'stickers'
      : kind === 'emoji-animated'
        ? 'emojis animados'
        : 'emojis estáticos';
  return `Os ${String(state.limit)} slots de ${what} deste servidor estão cheios. Apague um ou aumente o nível de impulso.`;
}

/** Data URL de emoji: PNG, JPEG, GIF ou WEBP até 256 KB. */
export const EmojiImageSchema = z.string().superRefine((value, ctx) => {
  const parsed = parseImageDataUrl(value, {
    mimeTypes: EMOJI_MIME_TYPES,
    maxBytes: MAX_EMOJI_BYTES,
  });
  if (parsed.ok) return;
  ctx.addIssue({
    code: 'custom',
    message:
      parsed.reason === 'size'
        ? 'O emoji passa de 256 KB, o teto do Discord.'
        : IMAGE_REJECTION_MESSAGE[parsed.reason],
  });
});

/** Data URL de sticker: PNG ou GIF até 512 KB. */
export const StickerImageSchema = z.string().superRefine((value, ctx) => {
  const parsed = parseImageDataUrl(value, {
    mimeTypes: STICKER_MIME_TYPES,
    maxBytes: MAX_STICKER_BYTES,
  });
  if (parsed.ok) return;
  ctx.addIssue({
    code: 'custom',
    message:
      parsed.reason === 'size'
        ? 'O sticker passa de 512 KB, o teto do Discord.'
        : 'Use PNG ou GIF.',
  });
});

/** O Discord só aceita letras, números e `_` no nome de um emoji. */
export const EmojiNameSchema = z
  .string()
  .trim()
  .min(MIN_EXPRESSION_NAME_LENGTH)
  .max(MAX_EMOJI_NAME_LENGTH)
  .regex(/^\w+$/, 'Use só letras, números e _');

export const StickerNameSchema = z
  .string()
  .trim()
  .min(MIN_EXPRESSION_NAME_LENGTH)
  .max(MAX_STICKER_NAME_LENGTH);

/** `POST /guilds/:id/expressions/emojis`. */
export const EmojiCreateInputSchema = z.object({
  ...actorFields,
  name: EmojiNameSchema,
  image: EmojiImageSchema,
  /** Cargos que enxergam o emoji; vazio = todo mundo. */
  roleIds: z.array(SnowflakeSchema).max(20).default([]),
});
export type EmojiCreateInput = z.infer<typeof EmojiCreateInputSchema>;

/** `PATCH /guilds/:id/expressions/emojis/:id` — renomear e trocar os cargos. */
export const EmojiUpdateInputSchema = EmojiCreateInputSchema.omit({ image: true });
export type EmojiUpdateInput = z.infer<typeof EmojiUpdateInputSchema>;

/** `POST /guilds/:id/expressions/stickers`. */
export const StickerCreateInputSchema = z.object({
  ...actorFields,
  name: StickerNameSchema,
  description: emptyToNull(z.string().trim().max(MAX_STICKER_DESCRIPTION_LENGTH)),
  /** O emoji relacionado; o Discord exige e usa na busca. */
  tags: z.string().trim().min(1).max(MAX_STICKER_TAGS_LENGTH),
  image: StickerImageSchema,
});
export type StickerCreateInput = z.infer<typeof StickerCreateInputSchema>;

export const StickerUpdateInputSchema = StickerCreateInputSchema.omit({ image: true });
export type StickerUpdateInput = z.infer<typeof StickerUpdateInputSchema>;

export const GuildEmojiSummarySchema = z.object({
  id: SnowflakeSchema,
  name: z.string(),
  url: z.url(),
  animated: z.boolean(),
  /** `false` quando o servidor perdeu impulso e o emoji ficou indisponível. */
  available: z.boolean(),
  /** Emoji de integração (Twitch, bot) — o painel não mexe nele. */
  managed: z.boolean(),
  roleIds: z.array(SnowflakeSchema),
  createdAt: z.iso.datetime().nullable(),
});
export type GuildEmojiSummary = z.infer<typeof GuildEmojiSummarySchema>;

export const GuildStickerSummarySchema = z.object({
  id: SnowflakeSchema,
  name: z.string(),
  description: z.string().nullable(),
  tags: z.string().nullable(),
  url: z.url(),
  available: z.boolean(),
  /** `StickerFormatType` do Discord; Lottie e APNG o painel só lista. */
  format: z.number().int(),
  createdAt: z.iso.datetime().nullable(),
});
export type GuildStickerSummary = z.infer<typeof GuildStickerSummarySchema>;

export const ExpressionOverviewSchema = z.object({
  emojis: z.array(GuildEmojiSummarySchema),
  stickers: z.array(GuildStickerSummarySchema),
  limits: ExpressionLimitsSchema,
  /** `false` quando falta `ManageGuildExpressions` ao bot. */
  canManage: z.boolean(),
});
export type ExpressionOverview = z.infer<typeof ExpressionOverviewSchema>;
