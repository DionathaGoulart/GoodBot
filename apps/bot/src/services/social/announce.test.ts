import { describe, expect, it } from 'vitest';

import { buildSocialMessage, socialVars } from './announce';

import type { SocialItem } from './types';

const ITEM: SocialItem = {
  externalId: 'aaaaaaaaaaa',
  kind: 'video',
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
});

describe('buildSocialMessage', () => {
  it('renderiza as variáveis no texto e no embed', () => {
    const message = buildSocialMessage(
      {
        content: '{author} publicou um {kind}!',
        embed: { title: '{title}', description: '{url}', color: null, fields: [], timestamp: false },
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
