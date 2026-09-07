import { describe, expect, it } from 'vitest';

import { diffJson, formatDiffValue } from './json-diff';

describe('diffJson', () => {
  it('sem mudança: lista vazia', () => {
    expect(diffJson({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toEqual([]);
  });

  it('classifica adicionado, removido e alterado', () => {
    const entries = diffJson(
      { mantido: 1, some: 'x', muda: 2 },
      { mantido: 1, muda: 3, novo: 'y' },
    );
    expect(entries).toEqual([
      { path: 'muda', kind: 'changed', before: 2, after: 3 },
      { path: 'novo', kind: 'added', before: undefined, after: 'y' },
      { path: 'some', kind: 'removed', before: 'x', after: undefined },
    ]);
  });

  it('desce em objetos aninhados e usa o caminho completo', () => {
    const entries = diffJson(
      { escalation: { warns: 3, action: 'kick' } },
      { escalation: { warns: 5, action: 'kick' } },
    );
    expect(entries).toEqual([{ path: 'escalation.warns', kind: 'changed', before: 3, after: 5 }]);
  });

  it('indexa arrays por posição', () => {
    const entries = diffJson({ roles: ['a', 'b'] }, { roles: ['a', 'c', 'd'] });
    expect(entries.map((entry) => entry.path)).toEqual(['roles[1]', 'roles[2]']);
    expect(entries[1]?.kind).toBe('added');
  });

  it('linha só com after (criação) vira tudo adicionado', () => {
    const entries = diffJson(null, { name: 'Mods', hoist: true });
    expect(entries.every((entry) => entry.kind === 'added')).toBe(true);
    expect(entries).toHaveLength(2);
  });

  it('valor escalar na raiz aparece como "(raiz)"', () => {
    expect(diffJson('antes', 'depois')[0]?.path).toBe('(raiz)');
  });
});

describe('formatDiffValue', () => {
  it('mostra ausência como travessão e serializa o resto', () => {
    expect(formatDiffValue(undefined)).toBe('—');
    expect(formatDiffValue(null)).toBe('null');
    expect(formatDiffValue('spam')).toBe('spam');
    expect(formatDiffValue([1, 2])).toBe('[1,2]');
  });
});
