import 'server-only';

import { createInternalClient } from '@cobot/shared';

import { env } from './env';

/**
 * Client da API do bot (PRD §5.7). Server-only: o Bearer nunca pode chegar ao
 * browser. Por padrão nada é cacheado — o painel mostra estado ao vivo.
 */
export function internalApi() {
  const { INTERNAL_API_URL, INTERNAL_API_TOKEN } = env();
  return createInternalClient({
    baseUrl: INTERNAL_API_URL,
    token: INTERNAL_API_TOKEN,
    fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
  });
}

/**
 * Mesma API, com cache do Next por `seconds`. Usado no que é barato ficar
 * levemente velho, como o `/health` do banner de status (§8).
 */
export function cachedInternalApi(seconds: number) {
  const { INTERNAL_API_URL, INTERNAL_API_TOKEN } = env();
  return createInternalClient({
    baseUrl: INTERNAL_API_URL,
    token: INTERNAL_API_TOKEN,
    fetch: (input, init) => fetch(input, { ...init, next: { revalidate: seconds } }),
  });
}
