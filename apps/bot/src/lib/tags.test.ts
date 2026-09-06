import { describe, expect, it } from 'vitest';

import { AUTOCOMPLETE_LIMIT, matchTagNames } from './tags';

const NAMES = ['ajuda', 'ajuda-cargos', 'banimento', 'regras', 'regras-voz'];

describe('matchTagNames', () => {
  it('sem busca devolve o começo da lista', () => {
    expect(matchTagNames(NAMES, '')).toEqual(NAMES);
    expect(matchTagNames(NAMES, '   ')).toEqual(NAMES);
  });

  it('põe os prefixos antes dos que só contêm', () => {
    expect(matchTagNames(NAMES, 'regras')).toEqual(['regras', 'regras-voz']);
    expect(matchTagNames(NAMES, 'cargos')).toEqual(['ajuda-cargos']);
    expect(matchTagNames(['x-ajuda', 'ajuda'], 'ajuda')).toEqual(['ajuda', 'x-ajuda']);
  });

  it('ignora caixa e espaços nas pontas', () => {
    expect(matchTagNames(NAMES, ' AJUDA ')).toEqual(['ajuda', 'ajuda-cargos']);
  });

  it('devolve lista vazia quando nada bate', () => {
    expect(matchTagNames(NAMES, 'zzz')).toEqual([]);
  });

  it('nunca passa do limite do Discord', () => {
    const many = Array.from({ length: 60 }, (_, index) => `tag-${index}`);
    expect(matchTagNames(many, 'tag')).toHaveLength(AUTOCOMPLETE_LIMIT);
    expect(matchTagNames(many, '')).toHaveLength(AUTOCOMPLETE_LIMIT);
    expect(matchTagNames(many, 'tag', 5)).toHaveLength(5);
  });
});
