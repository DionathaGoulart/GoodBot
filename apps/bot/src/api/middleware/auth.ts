import { createHash, timingSafeEqual } from 'node:crypto';

import { createMiddleware } from 'hono/factory';

import { ApiHttpError } from '../errors';

import type { ApiEnv } from '../context';

/**
 * Compara em tempo constante independentemente do tamanho: o SHA-256 dá dois
 * buffers de 32 bytes, então `timingSafeEqual` nunca lança por comprimento
 * diferente nem vaza o tamanho do token.
 */
export function tokensMatch(received: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(received), digest(expected));
}

/** Extrai o token de `Authorization: Bearer <token>`; `null` se ausente/malformado. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer (.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}

export function isAuthorized(header: string | undefined, expected: string): boolean {
  const received = bearerToken(header);
  return received !== null && tokensMatch(received, expected);
}

/**
 * Exige o Bearer. A resposta é sempre a mesma para token ausente e token
 * errado — nada aqui diz a um scanner o que ele acertou (PRD §7.3).
 */
export function bearerAuth(expected: string) {
  return createMiddleware<ApiEnv>(async (c, next) => {
    if (!isAuthorized(c.req.header('authorization'), expected)) {
      throw new ApiHttpError(401, 'UNAUTHORIZED', 'Token inválido.');
    }
    await next();
  });
}
