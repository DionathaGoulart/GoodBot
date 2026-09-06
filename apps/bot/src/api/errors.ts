import { UserFacingError } from '@cobot/shared';
import { DiscordAPIError, HTTPError } from 'discord.js';

import { childLogger } from '../logger';

import type { ApiError } from '@cobot/shared';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

const log = childLogger('api');

/** Erro com status HTTP próprio. Tudo que não é isto nem `UserFacingError` vira 500. */
export class ApiHttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly issues?: ApiError['error']['issues'],
    /** Headers extras da resposta (ex.: `retry-after` no 429). */
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiHttpError';
  }
}

export const notFound = (message: string, code = 'NOT_FOUND'): ApiHttpError =>
  new ApiHttpError(404, code, message);

export const forbidden = (message: string, code = 'FORBIDDEN'): ApiHttpError =>
  new ApiHttpError(403, code, message);

export function apiError(
  code: string,
  message: string,
  issues?: ApiError['error']['issues'],
): ApiError {
  return { error: { code, message, ...(issues && issues.length > 0 ? { issues } : {}) } };
}

/** `429` do Discord vira `503 + retryAfter` para o painel (PRD §7.4). */
function discordRetryAfterSeconds(error: unknown): number | null {
  if (error instanceof DiscordAPIError || error instanceof HTTPError) {
    if (error.status !== 429) return null;
  } else if (!isRateLimitLike(error)) {
    return null;
  }
  const retryAfter = (error as { retryAfter?: unknown }).retryAfter;
  // discord.js entrega `retryAfter` em ms; o header HTTP fala em segundos.
  if (typeof retryAfter === 'number' && Number.isFinite(retryAfter)) {
    return Math.max(1, Math.ceil(retryAfter / 1000));
  }
  return 1;
}

function isRateLimitLike(error: unknown): boolean {
  return error instanceof Error && error.name === 'RateLimitError';
}

export interface MappedError {
  status: ContentfulStatusCode;
  body: ApiError;
  headers?: Record<string, string>;
}

/**
 * Traduz qualquer coisa lançada por uma rota numa resposta. Stack e mensagem
 * de erro interno nunca chegam ao cliente (PRD §7.3): só o `requestId` do log.
 */
export function mapError(error: unknown, requestId: string): MappedError {
  if (error instanceof ApiHttpError) {
    return {
      status: error.status,
      body: apiError(error.code, error.message, error.issues),
      ...(error.headers ? { headers: error.headers } : {}),
    };
  }

  const retryAfter = discordRetryAfterSeconds(error);
  if (retryAfter !== null) {
    log.warn({ requestId, retryAfter }, 'Discord limitou a requisição');
    return {
      status: 503,
      body: apiError('DISCORD_RATE_LIMITED', `Discord limitou; tente em ${retryAfter}s.`),
      headers: { 'retry-after': String(retryAfter) },
    };
  }

  if (error instanceof UserFacingError) {
    return { status: 400, body: apiError(error.code, error.message) };
  }

  if (error instanceof DiscordAPIError) {
    log.error({ requestId, err: error }, 'erro da API do Discord');
    return { status: 502, body: apiError('DISCORD_ERROR', 'O Discord recusou a operação.') };
  }

  log.error({ requestId, err: error }, 'erro não tratado na API');
  return { status: 500, body: apiError('INTERNAL', 'Erro interno.') };
}
