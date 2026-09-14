import { describe, expect, it } from 'vitest';

import {
  SOCIAL_KIND_HEADLINE,
  SOCIAL_KIND_LABEL,
  SOCIAL_KINDS,
  SOCIAL_TEMPLATE_VARIABLES,
  TEMPLATE_VARIABLES,
} from '../constants';
import {
  DEFAULT_SOCIAL_CONFIG,
  SOCIAL_DEFAULT_TEMPLATE,
  SocialAccountInputSchema,
  SocialConfigSchema,
} from './social';

const CHANNEL = '123456789012345678';

/** Uma conta válida, base dos casos negativos. */
const VALID = {
  platform: 'youtube',
  externalId: 'UCabcdefghijklmnopqrstuv',
  discordChannelId: CHANNEL,
  kinds: ['video', 'short'],
  template: SOCIAL_DEFAULT_TEMPLATE,
} as const;

describe('SocialAccountInputSchema', () => {
  it('aceita uma conta válida e aplica os defaults', () => {
    const parsed = SocialAccountInputSchema.parse(VALID);
    expect(parsed.platform).toBe('youtube');
    expect(parsed.enabled).toBe(true);
    expect(parsed.mentionRoleId).toBeNull();
    expect(parsed.liveMentionRoleId).toBeNull();
    expect(parsed.handle).toBeNull();
    expect(parsed.avatarUrl).toBeNull();
  });

  it('recusa um ID de canal que não começa com UC', () => {
    const result = SocialAccountInputSchema.safeParse({ ...VALID, externalId: '@meucanal' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['externalId']);
  });

  it('recusa uma plataforma que não é o YouTube', () => {
    // O enum do Postgres ainda tem `twitch`; o schema é quem barra desde a v2.
    expect(SocialAccountInputSchema.safeParse({ ...VALID, platform: 'twitch' }).success).toBe(
      false,
    );
  });

  it('recusa `post`, que sobrou do enum antigo', () => {
    expect(SocialAccountInputSchema.safeParse({ ...VALID, kinds: ['post'] }).success).toBe(false);
  });

  it('recusa conta sem nenhum tipo marcado', () => {
    expect(SocialAccountInputSchema.safeParse({ ...VALID, kinds: [] }).success).toBe(false);
  });

  it('remove tipos repetidos', () => {
    const parsed = SocialAccountInputSchema.parse({ ...VALID, kinds: ['video', 'video', 'short'] });
    expect(parsed.kinds).toEqual(['video', 'short']);
  });

  it('trata campo vazio do formulário como não configurado', () => {
    const parsed = SocialAccountInputSchema.parse({ ...VALID, displayName: '', avatarUrl: '' });
    expect(parsed.displayName).toBeNull();
    expect(parsed.avatarUrl).toBeNull();
  });

  it('recusa avatar que não é https', () => {
    const result = SocialAccountInputSchema.safeParse({
      ...VALID,
      avatarUrl: 'http://yt3.ggpht.com/avatar.jpg',
    });
    expect(result.success).toBe(false);
  });
});

describe('SocialConfigSchema', () => {
  it('nasce desligado, com o intervalo padrão de três minutos', () => {
    expect(DEFAULT_SOCIAL_CONFIG.enabled).toBe(false);
    expect(DEFAULT_SOCIAL_CONFIG.pollIntervalSeconds).toBe(180);
    expect(SocialConfigSchema.parse({})).toEqual(DEFAULT_SOCIAL_CONFIG);
  });

  it('recusa intervalo abaixo de um minuto ou acima de meia hora', () => {
    expect(SocialConfigSchema.safeParse({ pollIntervalSeconds: 30 }).success).toBe(false);
    expect(SocialConfigSchema.safeParse({ pollIntervalSeconds: 3600 }).success).toBe(false);
  });
});

describe('SOCIAL_DEFAULT_TEMPLATE', () => {
  it('usa {headline}, que serve aos três tipos', () => {
    expect(SOCIAL_DEFAULT_TEMPLATE.content).toContain('{headline}');
  });
});

describe('rótulos dos tipos', () => {
  // Bot e painel leem os mesmos dois mapas: a tabela de contas, o `/social
  // list` e o `{headline}` do anúncio não podem chamar o mesmo tipo de nomes
  // diferentes.
  it('cobrem os três tipos, sem sobra', () => {
    expect(Object.keys(SOCIAL_KIND_LABEL).sort()).toEqual([...SOCIAL_KINDS].sort());
    expect(Object.keys(SOCIAL_KIND_HEADLINE).sort()).toEqual([...SOCIAL_KINDS].sort());
  });

  it('a frase de cada tipo é diferente das outras', () => {
    const phrases = new Set(Object.values(SOCIAL_KIND_HEADLINE));
    expect(phrases.size).toBe(SOCIAL_KINDS.length);
  });
});

describe('SOCIAL_TEMPLATE_VARIABLES', () => {
  it('é o subconjunto que a tela de redes sociais oferece', () => {
    for (const variable of SOCIAL_TEMPLATE_VARIABLES) {
      expect(TEMPLATE_VARIABLES).toContain(variable);
    }
    expect(SOCIAL_TEMPLATE_VARIABLES).toContain('headline');
    expect(SOCIAL_TEMPLATE_VARIABLES).not.toContain('memberCount');
  });
});
