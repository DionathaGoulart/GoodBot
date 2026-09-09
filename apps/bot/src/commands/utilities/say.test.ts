import { MAX_MESSAGE_CONTENT_LENGTH } from '@cobot/shared';
import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';

import say, { mentionOptions, pinOutcome, preview } from './say';

import type { APIApplicationCommandOption } from 'discord.js';

const json = say.data.toJSON();
const options = (json.options ?? []) as APIApplicationCommandOption[];
const byName = new Map(options.map((option) => [option.name, option]));

describe('/say', () => {
  it('só aparece para quem gerencia mensagens', () => {
    expect(json.default_member_permissions).toBe(String(PermissionFlagsBits.ManageMessages));
    expect(say.level).toBe('mod');
    expect(say.module).toBe('utilities');
  });

  it('não adia a interação: o texto vem por modal', () => {
    expect(say.opensModal).toBe(true);
    expect(say.defer).toBeFalsy();
  });

  it('pede canal, fixar e menções, e nada é obrigatório', () => {
    expect([...byName.keys()].sort()).toEqual(['canal', 'fixar', 'mencoes']);
    for (const option of options) expect(option.required).toBeFalsy();
  });
});

describe('mentionOptions', () => {
  it('por padrão não pinga ninguém', () => {
    expect(mentionOptions(false, true)).toEqual({ parse: [] });
  });

  it('com menções ligadas pinga usuário e cargo', () => {
    expect(mentionOptions(true, false)).toEqual({ parse: ['users', 'roles'] });
  });

  it('só solta @everyone para quem tem a permissão no Discord', () => {
    expect(mentionOptions(true, true)).toEqual({ parse: ['users', 'roles', 'everyone'] });
  });
});

describe('preview', () => {
  it('deixa o texto curto inteiro', () => {
    expect(preview('bom dia')).toBe('bom dia');
  });

  it('corta o texto longo e marca o corte', () => {
    const long = 'a'.repeat(MAX_MESSAGE_CONTENT_LENGTH);
    const short = preview(long);
    expect(short.endsWith('…')).toBe(true);
    expect(short.length).toBeLessThan(long.length);
  });
});

describe('pinOutcome', () => {
  it('no chat de canal de voz nem culpa o limite de fixadas', () => {
    const outcome = pinOutcome(true, false);
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('canal de voz');
    expect(outcome.detail).not.toContain('50');
  });

  it('fixou: diz que fixou', () => {
    expect(pinOutcome(false, true)).toEqual({ ok: true, detail: 'Fixada no canal.' });
  });

  it('falhou num canal de texto: aponta o limite de fixadas', () => {
    const outcome = pinOutcome(false, false);
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('50');
  });
});
