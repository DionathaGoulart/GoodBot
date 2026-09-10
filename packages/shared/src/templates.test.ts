import { describe, expect, it } from 'vitest';

import {
  EmbedTemplateSchema,
  findUnknownPlaceholders,
  MessageTemplateSchema,
  renderMessageTemplate,
  renderTemplate,
} from './templates';

describe('renderTemplate', () => {
  it('substitui variáveis conhecidas', () => {
    expect(
      renderTemplate('Bem-vindo {mention} ao {server}! Você é o membro #{memberCount}.', {
        mention: '<@123>',
        server: 'Goodbot',
        memberCount: 42,
      }),
    ).toBe('Bem-vindo <@123> ao Goodbot! Você é o membro #42.');
  });

  it('mantém placeholders sem valor ou desconhecidos', () => {
    expect(renderTemplate('{user} {foo} {server}', { user: 'ana' })).toBe('ana {foo} {server}');
  });

  it('não interpreta chaves fora do formato', () => {
    expect(renderTemplate('{ user } {1x} {}', { user: 'ana' })).toBe('{ user } {1x} {}');
  });

  it('aceita zero como valor', () => {
    expect(renderTemplate('{memberCount}', { memberCount: 0 })).toBe('0');
  });
});

describe('findUnknownPlaceholders', () => {
  it('lista só as variáveis desconhecidas, sem repetir', () => {
    expect(findUnknownPlaceholders('{user} {foo} {foo} {bar} {server}')).toEqual(['foo', 'bar']);
    expect(findUnknownPlaceholders('{user}')).toEqual([]);
  });
});

describe('MessageTemplateSchema', () => {
  it('aceita só conteúdo', () => {
    expect(MessageTemplateSchema.parse({ content: 'olá' })).toEqual({ content: 'olá' });
  });

  it('aceita só embed e aplica defaults', () => {
    const parsed = MessageTemplateSchema.parse({ embed: { description: 'x' } });
    expect(parsed.embed).toEqual({
      description: 'x',
      color: null,
      fields: [],
      timestamp: false,
    });
  });

  it('rejeita mensagem vazia e embed vazio', () => {
    expect(MessageTemplateSchema.safeParse({}).success).toBe(false);
    expect(MessageTemplateSchema.safeParse({ content: '   ' }).success).toBe(false);
    expect(EmbedTemplateSchema.safeParse({ color: 0xff0000 }).success).toBe(false);
  });

  it('rejeita cor fora do intervalo e URLs inválidas', () => {
    expect(EmbedTemplateSchema.safeParse({ title: 'a', color: 0x1000000 }).success).toBe(false);
    expect(EmbedTemplateSchema.safeParse({ title: 'a', image: 'nope' }).success).toBe(false);
    expect(EmbedTemplateSchema.safeParse({ title: 'a', thumbnail: 'user_avatar' }).success).toBe(
      true,
    );
  });
});

describe('renderMessageTemplate', () => {
  it('renderiza todos os textos do template', () => {
    const tpl = MessageTemplateSchema.parse({
      content: 'Oi {user}',
      embed: {
        title: 'Bem-vindo ao {server}',
        description: 'Membro {ordinal}',
        footer: '{tag}',
        fields: [{ name: 'ID de {user}', value: '{id}' }],
      },
    });
    const out = renderMessageTemplate(tpl, {
      user: 'ana',
      server: 'Goodbot',
      ordinal: '3º',
      tag: 'ana#0',
      id: '123',
    });
    expect(out.content).toBe('Oi ana');
    expect(out.embed?.title).toBe('Bem-vindo ao Goodbot');
    expect(out.embed?.description).toBe('Membro 3º');
    expect(out.embed?.footer).toBe('ana#0');
    expect(out.embed?.fields[0]).toEqual({ name: 'ID de ana', value: '123', inline: false });
  });
});
