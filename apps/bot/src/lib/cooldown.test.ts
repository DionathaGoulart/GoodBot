import { describe, expect, it } from 'vitest';

import { CooldownStore } from './cooldown';

describe('CooldownStore', () => {
  it('libera na primeira chamada e bloqueia dentro da janela', () => {
    let now = 0;
    const store = new CooldownStore(() => now);
    expect(store.hit('u1', 'ping', 5)).toBe(0);
    now = 2_000;
    expect(store.hit('u1', 'ping', 5)).toBe(3);
  });

  it('libera de novo depois da janela', () => {
    let now = 0;
    const store = new CooldownStore(() => now);
    store.hit('u1', 'ping', 5);
    now = 5_000;
    expect(store.hit('u1', 'ping', 5)).toBe(0);
  });

  it('isola usuários e comandos', () => {
    const store = new CooldownStore(() => 0);
    store.hit('u1', 'ping', 5);
    expect(store.hit('u2', 'ping', 5)).toBe(0);
    expect(store.hit('u1', 'help', 5)).toBe(0);
  });

  it('ignora cooldown zero ou negativo', () => {
    const store = new CooldownStore(() => 0);
    expect(store.hit('u1', 'ping', 0)).toBe(0);
    expect(store.hit('u1', 'ping', 0)).toBe(0);
  });

  it('sweep remove entradas vencidas', () => {
    let now = 0;
    const store = new CooldownStore(() => now);
    store.hit('u1', 'ping', 5);
    now = 10_000;
    store.sweep();
    expect(store.hit('u1', 'ping', 5)).toBe(0);
  });
});
