import { describe, expect, it } from 'vitest';

import { clientIp, createRateLimiter } from './rate-limit';

describe('createRateLimiter', () => {
  it('deixa passar até o limite e barra a partir dele', () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1_000, now: () => 0 });

    expect(limiter.hit('ip').allowed).toBe(true);
    expect(limiter.hit('ip').allowed).toBe(true);
    expect(limiter.hit('ip').allowed).toBe(true);
    expect(limiter.hit('ip').allowed).toBe(false);
  });

  it('a janela vira e o balde recomeça', () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => now });

    expect(limiter.hit('ip').allowed).toBe(true);
    expect(limiter.hit('ip').allowed).toBe(false);
    now = 1_001;
    expect(limiter.hit('ip').allowed).toBe(true);
  });

  it('cada chave tem o seu próprio balde', () => {
    const limiter = createRateLimiter({ limit: 1, now: () => 0 });
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('b').allowed).toBe(true);
  });

  it('informa quantos segundos faltam para a janela virar', () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => now });
    limiter.hit('ip');
    now = 30_000;
    expect(limiter.hit('ip').retryAfter).toBe(30);
  });
});

describe('clientIp', () => {
  const headersOf = (values: Record<string, string>) => ({
    get: (name: string) => values[name] ?? null,
  });

  it('usa o PRIMEIRO valor do x-forwarded-for (a borda da Vercel monta a lista)', () => {
    expect(clientIp(headersOf({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9');
  });

  it('cai no x-real-ip e depois em `unknown`', () => {
    expect(clientIp(headersOf({ 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7');
    expect(clientIp(headersOf({}))).toBe('unknown');
  });
});
