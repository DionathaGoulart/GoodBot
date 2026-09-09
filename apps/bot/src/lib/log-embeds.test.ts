import { describe, expect, it } from 'vitest';

import {
  actor,
  channelValue,
  logEmbed,
  reasonSuffix,
  roleValue,
  sentence,
  userIdValue,
  userValue,
} from './log-embeds';

const USER = { id: '111111111111111111', tag: 'fulano' };
const CHANNEL = '222222222222222222';
const ROLE = '333333333333333333';

describe('valores de log', () => {
  // O snowflake ao lado do nome enchia a largura do card com um número que
  // ninguém lê; quando ele importa, está no rodapé.
  it('não repete o ID ao lado da menção', () => {
    expect(userValue(USER)).toBe('<@111111111111111111> (fulano)');
    expect(userIdValue(USER.id)).toBe('<@111111111111111111>');
    expect(channelValue(CHANNEL)).toBe('<#222222222222222222>');
    expect(roleValue(ROLE)).toBe('<@&333333333333333333>');
  });

  it('sem tag mostra só a menção', () => {
    expect(userValue({ id: USER.id })).toBe('<@111111111111111111>');
    expect(userValue({ id: USER.id, tag: null })).toBe('<@111111111111111111>');
  });

  // Canal e cargo apagados não têm menção que resolva: aí o nome é a pista.
  it('leva o nome junto quando ele foi passado', () => {
    expect(channelValue(CHANNEL, 'geral')).toBe('<#222222222222222222> (#geral)');
    expect(roleValue(ROLE, 'Membro')).toBe('<@&333333333333333333> (Membro)');
  });
});

describe('sentence', () => {
  it('junta os pedaços e fecha com ponto', () => {
    expect(sentence('alguém', 'criou o canal', '<#1>')).toBe('alguém criou o canal <#1>.');
  });

  it('descarta pedaço vazio, nulo ou falso', () => {
    expect(sentence('entrou', null, undefined, false, 'em call')).toBe('entrou em call.');
  });

  it('não duplica pontuação que já existe', () => {
    expect(sentence('acabou!')).toBe('acabou!');
    expect(sentence('e agora?')).toBe('e agora?');
  });

  it('sem nada a dizer devolve string vazia', () => {
    expect(sentence(null, false)).toBe('');
  });
});

describe('actor', () => {
  // O audit log só responde dentro do timeout: sem autor a frase não pode
  // inventar um, mas também não pode ficar sem sujeito.
  it('vira "alguém" quando o audit log não respondeu', () => {
    expect(actor(null)).toBe('alguém');
  });

  it('menciona quem fez, quando se sabe', () => {
    expect(actor(USER)).toBe('<@111111111111111111>');
  });
});

describe('reasonSuffix', () => {
  it('vira o "por quê" da frase', () => {
    expect(reasonSuffix('spam')).toBe('Motivo: spam');
  });

  it('some quando não há motivo', () => {
    expect(reasonSuffix(null)).toBeNull();
    expect(reasonSuffix('')).toBeNull();
  });
});

describe('logEmbed', () => {
  it('põe a frase de resumo como descrição', () => {
    const embed = logEmbed({
      title: 'Canal criado',
      tone: 'create',
      description: sentence(actor(USER), 'criou o canal', channelValue(CHANNEL)),
    }).toJSON();

    expect(embed.title).toBe('> CANAL CRIADO');
    expect(embed.description).toBe('<@111111111111111111> criou o canal <#222222222222222222>.');
  });
});
