import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SOCIAL_CONFIG,
  SOCIAL_DEFAULT_TEMPLATES,
  SocialAccountInputSchema,
  SocialConfigSchema,
} from './social';

const CHANNEL = '123456789012345678';

/** Uma conta válida por plataforma, usada como base dos casos negativos. */
const VALID = {
  youtube: {
    platform: 'youtube',
    externalId: 'UCabcdefghijklmnopqrstuv',
    discordChannelId: CHANNEL,
    kinds: ['video', 'short'],
    template: SOCIAL_DEFAULT_TEMPLATES.youtube,
  },
  twitch: {
    platform: 'twitch',
    externalId: 'canal_teste',
    discordChannelId: CHANNEL,
    kinds: ['live'],
    template: SOCIAL_DEFAULT_TEMPLATES.twitch,
  },
  instagram: {
    platform: 'instagram',
    externalId: '17841400000000000',
    discordChannelId: CHANNEL,
    kinds: ['post'],
    template: SOCIAL_DEFAULT_TEMPLATES.instagram,
  },
  tiktok: {
    platform: 'tiktok',
    externalId: 'perfil.teste',
    discordChannelId: CHANNEL,
    kinds: ['video'],
    template: SOCIAL_DEFAULT_TEMPLATES.tiktok,
  },
} as const;

describe('SocialAccountInputSchema', () => {
  it('aceita uma conta válida de cada plataforma e aplica os defaults', () => {
    for (const account of Object.values(VALID)) {
      const parsed = SocialAccountInputSchema.parse(account);
      expect(parsed.enabled).toBe(true);
      expect(parsed.pollIntervalSeconds).toBe(300);
      expect(parsed.mentionRoleId).toBeNull();
      expect(parsed.handle).toBeNull();
    }
  });

  it('recusa um ID de canal do YouTube que não começa com UC', () => {
    const result = SocialAccountInputSchema.safeParse({
      ...VALID.youtube,
      externalId: '@meucanal',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['externalId']);
  });

  it('recusa um tipo que a plataforma não entrega', () => {
    // Twitch só tem live: pedir "short" é um erro de quem preencheu.
    const result = SocialAccountInputSchema.safeParse({
      ...VALID.twitch,
      kinds: ['short'],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path[0] === 'kinds')).toBe(true);
  });

  it('recusa conta sem nenhum tipo marcado', () => {
    expect(SocialAccountInputSchema.safeParse({ ...VALID.youtube, kinds: [] }).success).toBe(false);
  });

  it('remove tipos repetidos', () => {
    const parsed = SocialAccountInputSchema.parse({
      ...VALID.youtube,
      kinds: ['video', 'video', 'short'],
    });
    expect(parsed.kinds).toEqual(['video', 'short']);
  });

  it('recusa intervalo abaixo de um minuto', () => {
    const result = SocialAccountInputSchema.safeParse({
      ...VALID.youtube,
      pollIntervalSeconds: 30,
    });
    expect(result.success).toBe(false);
  });

  it('trata campo vazio do formulário como não configurado', () => {
    const parsed = SocialAccountInputSchema.parse({ ...VALID.youtube, displayName: '' });
    expect(parsed.displayName).toBeNull();
  });
});

describe('SocialConfigSchema', () => {
  it('nasce desligado e sem anunciar o passado', () => {
    expect(DEFAULT_SOCIAL_CONFIG.enabled).toBe(false);
    expect(DEFAULT_SOCIAL_CONFIG.announceBacklog).toBe(false);
    expect(SocialConfigSchema.parse({})).toEqual(DEFAULT_SOCIAL_CONFIG);
  });
});
