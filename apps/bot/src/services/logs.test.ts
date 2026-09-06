import { MAX_EMBED_FIELD_VALUE_LENGTH } from '@cobot/shared';
import { describe, expect, it } from 'vitest';

import { diffIds, fieldValue, formatDiff, quoteBlock, resolveLogTarget, truncate } from './logs';

import type { ResolveInput } from './logs';

function config(overrides: Partial<ResolveInput['config']> = {}): ResolveInput['config'] {
  return {
    enabled: true,
    channelId: null,
    ignoredChannelIds: [],
    ignoredRoleIds: [],
    ...overrides,
  };
}

describe('resolveLogTarget', () => {
  it('usa o canal do tipo quando ele existe', () => {
    const target = resolveLogTarget({
      config: config({ channelId: 'proprio' }),
      fallbackChannelId: 'geral',
    });
    expect(target).toEqual({ channelId: 'proprio' });
  });

  it('herda o canal geral quando o tipo não tem canal', () => {
    const target = resolveLogTarget({ config: config(), fallbackChannelId: 'geral' });
    expect(target).toEqual({ channelId: 'geral' });
  });

  it('não publica com o tipo desligado', () => {
    const target = resolveLogTarget({
      config: config({ enabled: false, channelId: 'proprio' }),
      fallbackChannelId: 'geral',
    });
    expect(target).toEqual({ skipped: 'kind-disabled' });
  });

  it('não publica sem canal do tipo nem canal geral', () => {
    expect(resolveLogTarget({ config: config(), fallbackChannelId: null })).toEqual({
      skipped: 'no-channel',
    });
  });

  it('ignora eventos vindos de um canal ignorado', () => {
    const target = resolveLogTarget({
      config: config({ channelId: 'proprio', ignoredChannelIds: ['secreto'] }),
      fallbackChannelId: null,
      context: { channelId: 'secreto' },
    });
    expect(target).toEqual({ skipped: 'ignored-channel' });
  });

  it('ignora eventos do próprio canal de log para não gerar laço', () => {
    const target = resolveLogTarget({
      config: config({ channelId: 'proprio' }),
      fallbackChannelId: null,
      context: { channelId: 'proprio' },
    });
    expect(target).toEqual({ skipped: 'ignored-channel' });
  });

  it('ignora quem tem um cargo ignorado', () => {
    const target = resolveLogTarget({
      config: config({ channelId: 'proprio', ignoredRoleIds: ['staff'] }),
      fallbackChannelId: null,
      context: { roleIds: ['membro', 'staff'] },
    });
    expect(target).toEqual({ skipped: 'ignored-role' });
  });

  it('publica quem não tem nenhum cargo ignorado', () => {
    const target = resolveLogTarget({
      config: config({ channelId: 'proprio', ignoredRoleIds: ['staff'] }),
      fallbackChannelId: null,
      context: { roleIds: ['membro'] },
    });
    expect(target).toEqual({ channelId: 'proprio' });
  });
});

describe('formatação', () => {
  it('trunca em 1024 caracteres com reticências', () => {
    const long = 'a'.repeat(2000);
    const result = truncate(long);
    expect(result).toHaveLength(MAX_EMBED_FIELD_VALUE_LENGTH);
    expect(result.endsWith('…')).toBe(true);
  });

  it('não mexe no que já cabe', () => {
    expect(truncate('curto')).toBe('curto');
  });

  it('o bloco de código cabe no limite do field', () => {
    const value = quoteBlock('b'.repeat(5000));
    expect(value.length).toBeLessThanOrEqual(MAX_EMBED_FIELD_VALUE_LENGTH);
    expect(value.startsWith('```')).toBe(true);
  });

  it('vazio vira traço em vez de estourar o embed', () => {
    expect(fieldValue('   ')).toBe('—');
    expect(fieldValue(null)).toBe('—');
    expect(quoteBlock('')).toBe('—');
  });

  it('o diff traz antes e depois, cada um truncado', () => {
    const [before, after] = formatDiff('x'.repeat(3000), 'novo');
    expect(before?.name).toBe('Antes');
    expect(before?.value.length).toBeLessThanOrEqual(MAX_EMBED_FIELD_VALUE_LENGTH);
    expect(after?.value).toContain('novo');
  });

  it('diffIds separa o que entrou do que saiu', () => {
    expect(diffIds(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] });
  });
});
