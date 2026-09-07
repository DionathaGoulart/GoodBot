import { UserFacingError } from '@cobot/shared';
import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';

import {
  assertBotAuthored,
  assertCanMentionEveryone,
  toMentionOptions,
  toTemplate,
} from './messages';

const BOT_ID = '100000000000000001';
const HUMAN_ID = '200000000000000002';

function actorWith(flags: bigint[]) {
  return { permissions: { has: (flag: bigint) => flags.includes(flag) } };
}

describe('toMentionOptions', () => {
  it('sem nada marcado, ninguém é mencionado', () => {
    expect(toMentionOptions({ users: false, roles: false, everyone: false })).toEqual({
      parse: [],
    });
  });

  it('só entra em `parse` o que foi marcado', () => {
    expect(toMentionOptions({ users: true, roles: false, everyone: true })).toEqual({
      parse: ['users', 'everyone'],
    });
  });
});

describe('assertBotAuthored', () => {
  it('deixa passar mensagem do próprio bot', () => {
    expect(() => assertBotAuthored({ author: { id: BOT_ID } }, BOT_ID)).not.toThrow();
  });

  it('recusa editar mensagem de outra pessoa', () => {
    expect(() => assertBotAuthored({ author: { id: HUMAN_ID } }, BOT_ID)).toThrow(UserFacingError);
  });
});

describe('assertCanMentionEveryone', () => {
  it('exige a permissão do Discord', () => {
    expect(() => assertCanMentionEveryone(actorWith([]))).toThrow(/permissão/);
  });

  it('passa com `MentionEveryone`', () => {
    expect(() =>
      assertCanMentionEveryone(actorWith([PermissionFlagsBits.MentionEveryone])),
    ).not.toThrow();
  });
});

describe('toTemplate', () => {
  it('relê uma mensagem de texto como template', () => {
    expect(toTemplate({ content: 'olá', embeds: [] })).toEqual({ content: 'olá' });
  });

  it('devolve `null` para o que o editor não sabe reconstruir', () => {
    expect(toTemplate({ content: '', embeds: [] })).toBeNull();
  });
});
