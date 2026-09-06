import { MINUTE_MS } from '@cobot/shared';
import { getConnInfo } from '@hono/node-server/conninfo';
import { createMiddleware } from 'hono/factory';

import { ApiHttpError } from '../errors';

import type { ApiEnv } from '../context';

/** Teto por IP e por rota (PRD §7.3). */
export const IP_LIMIT_PER_MINUTE = 60;
export const ROUTE_LIMIT_PER_MINUTE = 100;

interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimiterOptions {
  limit: number;
  windowMs?: number;
  now?: () => number;
}

export interface RateLimitHit {
  allowed: boolean;
  /** Segundos até a janela virar. */
  retryAfter: number;
}

/**
 * Contador de janela fixa em memória. Um processo só atende a API (o bot),
 * então não há estado para compartilhar; se um dia houver réplica, isto vira
 * uma tabela ou um Redis sem tocar nas rotas.
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const windowMs = options.windowMs ?? MINUTE_MS;
  const now = options.now ?? Date.now;
  const windows = new Map<string, Window>();

  return {
    hit(key: string): RateLimitHit {
      const at = now();
      const current = windows.get(key);
      const window =
        current && current.resetAt > at ? current : { count: 0, resetAt: at + windowMs };
      window.count += 1;
      windows.set(key, window);

      // Sem sweeper dedicado: a limpeza acontece na própria passagem.
      if (windows.size > 5_000) {
        for (const [k, w] of windows) if (w.resetAt <= at) windows.delete(k);
      }

      return {
        allowed: window.count <= options.limit,
        retryAfter: Math.max(1, Math.ceil((window.resetAt - at) / 1000)),
      };
    },
    reset(): void {
      windows.clear();
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;

/**
 * IP de quem chamou. Atrás do Caddy o `X-Forwarded-For` é *anexado*, então o
 * último valor é o que o proxy realmente observou — os anteriores podem ter
 * sido forjados pelo cliente.
 */
export function clientIp(forwardedFor: string | undefined, fallback: string): string {
  const parts = (forwardedFor ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.at(-1) ?? fallback;
}

/**
 * Chave por rota. O caminho é normalizado (snowflakes e UUIDs viram `:id`)
 * porque o `routePath` do Hono ainda não existe num middleware global.
 */
export function routeKey(method: string, path: string): string {
  const normalized = path
    .replace(/\/\d{17,20}(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id');
  return `${method} ${normalized}`;
}

export interface RateLimitMiddlewareOptions {
  ipLimiter: RateLimiter;
  routeLimiter: RateLimiter;
}

export function rateLimit({ ipLimiter, routeLimiter }: RateLimitMiddlewareOptions) {
  return createMiddleware<ApiEnv>(async (c, next) => {
    let remote = 'local';
    try {
      remote = getConnInfo(c).remote.address ?? 'local';
    } catch {
      // Fora do adapter Node (testes com `app.request`) não há socket.
    }
    const ip = clientIp(c.req.header('x-forwarded-for'), remote);

    const byIp = ipLimiter.hit(ip);
    if (!byIp.allowed) throw tooMany(byIp.retryAfter);

    const byRoute = routeLimiter.hit(routeKey(c.req.method, new URL(c.req.url).pathname));
    if (!byRoute.allowed) throw tooMany(byRoute.retryAfter);

    await next();
  });
}

function tooMany(retryAfter: number): ApiHttpError {
  return new ApiHttpError(
    429,
    'RATE_LIMITED',
    `Muitas requisições; tente em ${retryAfter}s.`,
    undefined,
    { 'retry-after': String(retryAfter) },
  );
}
