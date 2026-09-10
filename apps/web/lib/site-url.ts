import 'server-only';

import { env } from './env';

import type { SiteHost } from './hosts';

/**
 * A URL absoluta de cada um dos quatro hostnames, derivada do `AUTH_URL`.
 *
 * O `AUTH_URL` já é o endereço do painel (`https://goodbot.<domínio>`), e os
 * outros três são o mesmo host com um rótulo na frente. Derivar em vez de
 * pedir quatro variáveis tem um motivo prático: o `redirect_uri` que vai ao
 * Discord **não pode** sair do header `Host` da requisição — quem manda o
 * header é o cliente, e a URL de callback é exatamente o que precisa ser
 * estável. Trocar de domínio continua sendo trocar uma variável só.
 */
export function siteUrl(site: SiteHost, path = '/'): string {
  const url = new URL(env().AUTH_URL);
  if (site !== 'app') url.hostname = `${site}.${url.hostname}`;
  return new URL(path, url.origin).toString();
}
