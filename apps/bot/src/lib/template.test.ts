import { MessageTemplateSchema } from '@cobot/shared';
import { describe, expect, it } from 'vitest';

import { memberVars, ordinal, sanitizeVar, templateToMessage } from './template';

import type { EmbedBuilder } from 'discord.js';

/** `GuildMember` o bastante para o que `memberVars` lê. */
function fakeMember(overrides: { username?: string; guildName?: string } = {}) {
  return {
    id: '123456789012345678',
    user: {
      username: overrides.username ?? 'dio',
      displayName: overrides.username ?? 'dio',
      tag: `${overrides.username ?? 'dio'}#0001`,
    },
    guild: { name: overrides.guildName ?? 'CoBot', memberCount: 42 },
  } as never;
}

describe('sanitizeVar', () => {
  it('quebra @everyone e @here', () => {
    expect(sanitizeVar('@everyone')).toBe('@\u200beveryone');
    expect(sanitizeVar('oi @here!')).toBe('oi @\u200bhere!');
  });

  it('não mexe em texto comum nem em menções de usuário', () => {
    expect(sanitizeVar('dio')).toBe('dio');
    expect(sanitizeVar('<@123>')).toBe('<@123>');
  });
});

describe('memberVars', () => {
  it('preenche todas as variáveis do template', () => {
    expect(memberVars(fakeMember())).toEqual({
      user: 'dio',
      mention: '<@123456789012345678>',
      tag: 'dio#0001',
      id: '123456789012345678',
      server: 'CoBot',
      memberCount: 42,
      ordinal: '42º',
    });
  });

  it('sanitiza nome de usuário e de servidor', () => {
    const vars = memberVars(fakeMember({ username: '@everyone', guildName: '@here' }));
    expect(vars.user).toBe('@\u200beveryone');
    expect(vars.server).toBe('@\u200bhere');
  });

  it('aceita uma contagem explícita', () => {
    expect(memberVars(fakeMember(), 7).ordinal).toBe('7º');
  });
});

describe('ordinal', () => {
  it('usa a forma pt-BR', () => {
    expect(ordinal(1)).toBe('1º');
    expect(ordinal(1234)).toBe('1234º');
  });
});

describe('templateToMessage', () => {
  const vars = memberVars(fakeMember());

  it('renderiza content e embed com as variáveis', () => {
    const template = MessageTemplateSchema.parse({
      content: 'Bem-vindo {mention}!',
      embed: {
        title: '{server}',
        description: 'Você é o {ordinal} membro.',
        fields: [{ name: 'Conta', value: '{tag}' }],
      },
    });
    const message = templateToMessage(template, vars, { embedColor: 0x123456 });

    expect(message.content).toBe('Bem-vindo <@123456789012345678>!');
    const embed = (message.embeds?.[0] as EmbedBuilder | undefined)?.toJSON();
    expect(embed?.title).toBe('CoBot');
    expect(embed?.description).toBe('Você é o 42º membro.');
    expect(embed?.fields?.[0]?.value).toBe('dio#0001');
    expect(embed?.color).toBe(0x123456);
  });

  it('só deixa passar menção de usuário', () => {
    const template = MessageTemplateSchema.parse({ content: '@everyone chegou {user}' });
    const message = templateToMessage(template, vars);
    // O texto do autor fica intacto; quem impede o ping é o allowedMentions.
    expect(message.content).toBe('@everyone chegou dio');
    expect(message.allowedMentions).toEqual({ parse: ['users'] });
  });

  it('não deixa um apelido virar ping de @everyone', () => {
    const template = MessageTemplateSchema.parse({ content: 'oi {user}' });
    const hostile = memberVars(fakeMember({ username: '@everyone' }));
    expect(templateToMessage(template, hostile).content).toBe('oi @\u200beveryone');
  });

  it('mantém placeholder desconhecido para o autor perceber', () => {
    const template = MessageTemplateSchema.parse({ content: 'oi {nome}' });
    expect(templateToMessage(template, vars).content).toBe('oi {nome}');
  });

  it('sem content não manda string vazia', () => {
    const template = MessageTemplateSchema.parse({ embed: { description: 'oi' } });
    expect(templateToMessage(template, vars).content).toBeUndefined();
  });
});
