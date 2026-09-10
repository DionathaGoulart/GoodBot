import { describe, expect, it } from 'vitest';

import { buildSocialMessage, sampleSocialItem, socialVars } from './announce';

import type { SocialItem } from './types';

const ITEM: SocialItem = {
  externalId: 'aaaaaaaaaaa',
  kind: 'video',
  headline: 'publicou um vídeo novo',
  title: 'Título @everyone',
  url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
  author: 'Canal',
  thumbnail: 'https://i4.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg',
  publishedAt: new Date('2026-09-07T00:00:00Z'),
};

const ROLE_ID = '700000000000000000';

describe('socialVars', () => {
  it('neutraliza @everyone vindo do título da publicação', () => {
    expect(socialVars(ITEM, 'youtube').title).toBe('Título @​everyone');
  });

  it('traduz plataforma e tipo para o texto do anúncio', () => {
    const vars = socialVars(ITEM, 'youtube');
    expect(vars.platform).toBe('YouTube');
    expect(vars.kind).toBe('vídeo');
  });

  it('usa o headline que o provider mandou', () => {
    expect(
      socialVars({ ...ITEM, kind: 'live', headline: 'está ao vivo' }, 'youtube').headline,
    ).toBe('está ao vivo');
  });

  it('cai no headline do tipo quando o item não trouxe um', () => {
    expect(socialVars({ ...ITEM, kind: 'short', headline: '' }, 'youtube').headline).toBe(
      'publicou um short',
    );
  });
});

describe('buildSocialMessage', () => {
  it('renderiza as variáveis no texto e no embed', () => {
    const message = buildSocialMessage(
      {
        content: '{author} publicou um {kind}!',
        embed: {
          title: '{title}',
          description: '{url}',
          color: null,
          fields: [],
          timestamp: false,
        },
      },
      ITEM,
      'youtube',
    );

    expect(message.content).toBe('Canal publicou um vídeo!');
    expect(message.embeds?.[0]).toMatchObject({
      data: { description: ITEM.url, image: { url: ITEM.thumbnail } },
    });
  });

  it('menciona só o cargo configurado — nunca @everyone nem usuários', () => {
    const message = buildSocialMessage({ content: '{title}' }, ITEM, 'youtube', {
      mentionRoleId: ROLE_ID,
    });

    expect(message.content?.startsWith(`<@&${ROLE_ID}> `)).toBe(true);
    expect(message.allowedMentions).toEqual({ parse: [], roles: [ROLE_ID] });
  });

  it('sem cargo, a mensagem não pinga ninguém', () => {
    const message = buildSocialMessage({ content: '{title}' }, ITEM, 'youtube');
    expect(message.allowedMentions).toEqual({ parse: [], roles: [] });
  });

  it('{headline} dá o verbo certo a cada tipo com um template só', () => {
    const template = { content: '{author} {headline}' };
    const frase = (item: SocialItem) => buildSocialMessage(template, item, 'youtube').content;

    expect(frase(ITEM)).toBe('Canal publicou um vídeo novo');
    expect(frase({ ...ITEM, kind: 'short', headline: 'publicou um short' })).toBe(
      'Canal publicou um short',
    );
    expect(frase({ ...ITEM, kind: 'live', headline: 'está ao vivo' })).toBe('Canal está ao vivo');
  });

  it('o anúncio de teste também traz o headline do tipo', () => {
    expect(sampleSocialItem('youtube', 'live').headline).toBe('está ao vivo');
  });

  it('não sobrescreve a imagem escolhida no template', () => {
    const message = buildSocialMessage(
      {
        embed: {
          description: 'oi',
          image: 'https://exemplo.com/propria.png',
          color: null,
          fields: [],
          timestamp: false,
        },
      },
      ITEM,
      'youtube',
    );

    expect(message.embeds?.[0]).toMatchObject({
      data: { image: { url: 'https://exemplo.com/propria.png' } },
    });
  });
});
