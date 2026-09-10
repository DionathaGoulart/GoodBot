import 'server-only';

import { subdomainUrl } from '@goodbot/shared';

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
 *
 * A montagem em si está em `shared` porque o bot faz a mesma conta para o link
 * do convite que ele manda quando a demo acaba.
 */
export function siteUrl(site: SiteHost, path = '/'): string {
  return subdomainUrl(env().AUTH_URL, site === 'app' ? null : site, path);
}
