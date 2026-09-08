import { SECOND_MS } from '@cobot/shared';

import { SocialProviderError } from './types';

import type { SocialPlatform } from '@cobot/shared';

/** Nenhuma API de rede social merece segurar o job por mais que isto. */
export const SOCIAL_HTTP_TIMEOUT_MS = 10 * SECOND_MS;

/** `User-Agent` honesto: alguns feeds recusam cliente sem identificação. */
export const SOCIAL_USER_AGENT = 'CoBot/1.0 (+https://github.com/DionathaGoulart/cobot)';

/**
 * Cabeçalhos de toda requisição ao YouTube. `SOCS=CAI` é o cookie que a própria
 * parede de consentimento grava quando alguém clica em "rejeitar tudo": sem
 * ele, um IP da UE recebe um redirect para `consent.youtube.com` no lugar da
 * página, e o parser não acharia nem canonical nem `og:*`. A VM está fora da
 * UE, mas o cookie custa 12 bytes e elimina o caso de vez.
 *
 * `Accept-Language` mantém `og:title` no idioma do canal em vez do idioma que
 * o YouTube adivinha pelo IP do datacenter.
 */
export const YOUTUBE_HEADERS: Record<string, string> = {
  cookie: 'SOCS=CAI',
  'accept-language': 'pt-BR,pt;q=0.9',
};

export interface SocialFetchOptions {
  platform: SocialPlatform;
  headers?: Record<string, string>;
  method?: 'GET' | 'HEAD' | 'POST';
  body?: string;
  /** `'manual'` para ler o 3xx em vez de segui-lo (short vs. vídeo do YouTube). */
  redirect?: 'follow' | 'manual' | 'error';
  fetch?: typeof globalThis.fetch;
}

/**
 * Uma requisição de provider. Centraliza timeout, `User-Agent` e a tradução de
 * qualquer falha em `SocialProviderError` com mensagem em pt-BR — é essa
 * mensagem que vira `disabled_reason` e chega ao painel.
 */
export async function socialFetch(url: string, options: SocialFetchOptions): Promise<Response> {
  const doFetch = options.fetch ?? globalThis.fetch;
  try {
    return await doFetch(url, {
      method: options.method ?? 'GET',
      headers: {
        'user-agent': SOCIAL_USER_AGENT,
        ...YOUTUBE_HEADERS,
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: options.body }),
      ...(options.redirect ? { redirect: options.redirect } : {}),
      signal: AbortSignal.timeout(SOCIAL_HTTP_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new SocialProviderError(
      timedOut ? 'A plataforma não respondeu a tempo.' : 'Não foi possível falar com a plataforma.',
      options.platform,
      { cause: error },
    );
  }
}

/** `socialFetch` + checagem de status. O corpo do erro nunca vaza para o log. */
export async function socialFetchOk(url: string, options: SocialFetchOptions): Promise<Response> {
  const response = await socialFetch(url, options);
  if (!response.ok) {
    throw new SocialProviderError(
      `A plataforma respondeu ${String(response.status)}.`,
      options.platform,
    );
  }
  return response;
}
