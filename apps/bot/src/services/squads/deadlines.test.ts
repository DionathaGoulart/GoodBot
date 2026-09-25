import { describe, expect, it } from 'vitest';

import { DeadlineBook } from './deadlines';

describe('DeadlineBook', () => {
  it('entrega só o que venceu e tira do livro', () => {
    const book = new DeadlineBook();
    book.set('g', 'a', { at: 10 });
    book.set('g', 'b', { at: 20 });
    expect(book.takeDue(15).map((d) => d.id)).toEqual(['a']);
    expect(book.size).toBe(1);
    expect(book.takeDue(15)).toEqual([]);
  });

  it('um prazo novo substitui o anterior do mesmo id', () => {
    const book = new DeadlineBook();
    book.set('g', 'a', { at: 10 });
    book.set('g', 'a', { at: 50 });
    expect(book.takeDue(20)).toEqual([]);
    expect(book.get('g', 'a')).toEqual({ at: 50 });
  });

  it('é por guild', () => {
    const book = new DeadlineBook();
    book.set('g1', 'a', { at: 10 });
    book.set('g2', 'a', { at: 10 });
    book.clearGuild('g1');
    expect(book.takeDue(10).map((d) => d.guildId)).toEqual(['g2']);
  });
});
