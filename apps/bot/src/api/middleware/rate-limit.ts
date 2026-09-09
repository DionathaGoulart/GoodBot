import { MINUTE_MS } from '@cobot/shared';
import { getConnInfo } from '@hono/node-server/conninfo';
import { createMiddleware } from 'hono/factory';

import { ApiHttpError } from '../errors';
import { isAuthorized } from './auth';

import type { ApiEnv } from '../context';

/** Teto por IP e por rota para quem chega sem token (PRD §7.3). */
export const IP_LIMIT_PER_MINUTE = 60;
export const ROUTE_LIMIT_PER_MINUTE = 100;

/**
 * Teto de quem apresenta o `INTERNAL_API_TOKEN`. Bem mais alto porque o balde
 * apertado existe contra scanner e flood anônimo, e o painel não é nem uma
 * coisa nem outra: ele roda na Vercel e **sai todo por um punhado de IPs**, de
 * modo que o teto por IP contava o painel inteiro como um cliente só.
 *
 * O efeito era o painel se estrangular sozinho. Uma tela que reordena cargos
 * gasta ~4 chamadas por clique (a escrita, mais o `member` e o `roles` que a
 * revalidação refaz), então bastava um punhado de cliques por minuto para o
 * teto de 60 devolver 429 no meio do trabalho de quem estava autenticado.
 *
 * Quem tem o token já pode fazer tudo que a API oferece; segurá-lo em 60/min
 * não protege de nada, só atrapalha o uso legítimo. A defesa contra vazamento
 * do token é rotacioná-lo, não racioná-lo.
 */
export const TRUSTED_IP_LIMIT_PER_MINUTE = 600;
export const TRUSTED_ROUTE_LIMIT_PER_MINUTE = 600;

/**
 * Teto de mensagens escritas pelo painel numa guild (PRD §7.4). Bem abaixo
 * dos outros: mandar mensagem em canal é o endpoint mais fácil de abusar do
 * painel inteiro, e ninguém escreve dez mensagens à mão por minuto.
 */
export const MESSAGE_LIMIT_PER_MINUTE = 10;

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
  /**
   * Baldes de quem apresenta o token. Opcionais para o middleware seguir
   * montável sem eles (testes), e nesse caso todo mundo cai no balde apertado.
   */
  trustedIpLimiter?: RateLimiter;
  trustedRouteLimiter?: RateLimiter;
  token?: string;
}

export function rateLimit({
  ipLimiter,
  routeLimiter,
  trustedIpLimiter,
  trustedRouteLimiter,
  token,
}: RateLimitMiddlewareOptions) {
  return createMiddleware<ApiEnv>(async (c, next) => {
    let remote = 'local';
    try {
      remote = getConnInfo(c).remote.address ?? 'local';
    } catch {
      // Fora do adapter Node (testes com `app.request`) não há socket.
    }
    const ip = clientIp(c.req.header('x-forwarded-for'), remote);

    // Este middleware continua vindo **antes** da auth, para que uma inundação
    // sem token custe o mínimo. Conferir o Bearer aqui é só um SHA-256, e é o
    // que separa o painel autenticado do tráfego anônimo — sem isso os dois
    // dividem o mesmo balde por IP e o painel se estrangula sozinho.
    const trusted =
      trustedIpLimiter !== undefined &&
      trustedRouteLimiter !== undefined &&
      token !== undefined &&
      isAuthorized(c.req.header('authorization'), token);

    const byIp = (trusted ? trustedIpLimiter : ipLimiter).hit(ip);
    if (!byIp.allowed) throw tooMany(byIp.retryAfter);

    const routeK = routeKey(c.req.method, new URL(c.req.url).pathname);
    const byRoute = (trusted ? trustedRouteLimiter : routeLimiter).hit(routeK);
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

/**
 * Limite por guild, para pendurar numa rota específica. Independe do balde
 * global por IP: o painel inteiro fala com a API de um punhado de IPs da
 * Vercel, então contar por guild é o que separa "muita gente usando o painel"
 * de "alguém floodando um canal".
 */
export function guildRateLimit(limiter: RateLimiter) {
  return createMiddleware<ApiEnv>(async (c, next) => {
    const hit = limiter.hit(c.req.param('guildId') ?? 'unknown');
    if (!hit.allowed) throw tooMany(hit.retryAfter);
    await next();
  });
}
