import { MINUTE_MS } from '@goodbot/shared';

/** Teto por IP, igual ao da API do bot (PRD §7.3). */
export const WEB_LIMIT_PER_MINUTE = 60;

interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Segundos até a janela virar. */
  retryAfter: number;
}

export interface RateLimiterOptions {
  limit?: number;
  windowMs?: number;
  now?: () => number;
}

/**
 * Janela fixa em memória.
 *
 * **Limitação assumida:** o painel roda na Vercel e é stateless (PRD §7.5), então
 * cada instância conta o seu próprio balde e o teto real é `limite × instâncias`.
 * Isso é aceitável para o que este limite existe: cortar o script que dispara
 * centenas de requisições do mesmo IP, não implementar cota. Um limite exato
 * exigiria um store compartilhado, e a stack está fechada em §12 (sem Redis).
 * A barreira que **não** depende disto é a autorização, checada em toda action.
 */
export function createRateLimiter(options: RateLimiterOptions = {}) {
  const limit = options.limit ?? WEB_LIMIT_PER_MINUTE;
  const windowMs = options.windowMs ?? MINUTE_MS;
  const now = options.now ?? Date.now;
  const windows = new Map<string, Window>();

  return {
    hit(key: string): RateLimitResult {
      const at = now();
      const current = windows.get(key);
      const window =
        current && current.resetAt > at ? current : { count: 0, resetAt: at + windowMs };
      window.count += 1;
      windows.set(key, window);

      // Limpeza oportunista: sem timer, que numa lambda nunca dispararia.
      if (windows.size > 2_000) {
        for (const [k, w] of windows) if (w.resetAt <= at) windows.delete(k);
      }

      return {
        allowed: window.count <= limit,
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
 * IP do cliente. Na Vercel o `x-forwarded-for` é montado pela borda e o
 * **primeiro** valor é o cliente real (o oposto do Caddy, onde o proxy anexa
 * ao que o cliente mandou — ver `apps/bot/src/api/middleware/rate-limit.ts`).
 */
export function clientIp(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || headers.get('x-real-ip') || 'unknown';
}

/**
 * Um limitador por processo. Módulo de topo de propósito: numa lambda quente o
 * estado sobrevive entre requisições, que é exatamente o alcance pretendido.
 */
export const actionLimiter = createRateLimiter();
export const authLimiter = createRateLimiter();
