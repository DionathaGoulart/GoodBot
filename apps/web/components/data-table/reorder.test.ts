import { describe, expect, it } from 'vitest';

import { moveRow } from './reorder';

const IDS = ['a', 'b', 'c'];

describe('reordenação de prioridade', () => {
  it('sobe um item uma casa', () => {
    expect(moveRow(IDS, 1, -1)).toEqual(['b', 'a', 'c']);
  });

  it('desce um item uma casa', () => {
    expect(moveRow(IDS, 1, 1)).toEqual(['a', 'c', 'b']);
  });

  it('devolve null nas bordas', () => {
    expect(moveRow(IDS, 0, -1)).toBeNull();
    expect(moveRow(IDS, 2, 1)).toBeNull();
  });

  it('não perde nem duplica itens', () => {
    expect(new Set(moveRow(IDS, 0, 1))).toEqual(new Set(IDS));
  });
});
