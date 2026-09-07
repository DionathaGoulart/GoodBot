import { describe, expect, it } from 'vitest';

import {
  EMOJI_SLOTS_BY_TIER,
  EmojiCreateInputSchema,
  EmojiNameSchema,
  STICKER_SLOTS_BY_TIER,
  emojiSlotState,
  emojiSlots,
  slotsFullMessage,
  stickerSlotState,
  stickerSlots,
} from './expressions';

const ACTOR = '200000000000000000';

/** PNG de 1x1 como data URL, o menor upload válido possível. */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('slots por nível de impulso', () => {
  it('segue a tabela do Discord', () => {
    expect([0, 1, 2, 3].map(emojiSlots)).toEqual([...EMOJI_SLOTS_BY_TIER]);
    expect([0, 1, 2, 3].map(stickerSlots)).toEqual([...STICKER_SLOTS_BY_TIER]);
  });

  it('nível fora de 0–3 vira o mais próximo em vez de explodir', () => {
    expect(emojiSlots(-1)).toBe(EMOJI_SLOTS_BY_TIER[0]);
    expect(emojiSlots(9)).toBe(EMOJI_SLOTS_BY_TIER[3]);
  });

  it('conta emoji animado e estático em cotas separadas', () => {
    const limits = { premiumTier: 0, staticEmojis: 50, animatedEmojis: 3, stickers: 0 };
    expect(emojiSlotState(limits, false)).toEqual({
      limit: 50,
      used: 50,
      remaining: 0,
      full: true,
    });
    expect(emojiSlotState(limits, true)).toEqual({ limit: 50, used: 3, remaining: 47, full: false });
  });

  it('impulso nível 2 abre mais slots com os mesmos emojis', () => {
    const used = { staticEmojis: 100, animatedEmojis: 0, stickers: 0 };
    expect(emojiSlotState({ ...used, premiumTier: 1 }, false).full).toBe(true);
    expect(emojiSlotState({ ...used, premiumTier: 2 }, false).remaining).toBe(50);
  });

  it('sticker tem cota única', () => {
    expect(
      stickerSlotState({ premiumTier: 0, staticEmojis: 0, animatedEmojis: 0, stickers: 5 }),
    ).toEqual({ limit: 5, used: 5, remaining: 0, full: true });
  });

  it('a recusa diz quantos slots o servidor tem', () => {
    const state = { limit: 50, used: 50, remaining: 0, full: true };
    expect(slotsFullMessage('emoji-animated', state)).toContain('50');
    expect(slotsFullMessage('emoji-animated', state)).toContain('animados');
  });
});

describe('EmojiNameSchema', () => {
  it('aceita letras, números e sublinhado', () => {
    expect(EmojiNameSchema.safeParse('cobot_ok1').success).toBe(true);
  });

  it('recusa espaço e acento', () => {
    expect(EmojiNameSchema.safeParse('não vai').success).toBe(false);
  });
});

describe('EmojiCreateInputSchema', () => {
  it('aceita um PNG pequeno sem cargos', () => {
    const parsed = EmojiCreateInputSchema.safeParse({
      actorId: ACTOR,
      name: 'cobot',
      image: TINY_PNG,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.roleIds).toEqual([]);
  });

  it('recusa formato que o Discord não aceita em emoji', () => {
    const parsed = EmojiCreateInputSchema.safeParse({
      actorId: ACTOR,
      name: 'cobot',
      image: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    });
    expect(parsed.success).toBe(false);
  });
});
