import type { InviteFlow } from '@goodbot/shared';

/**
 * Os quatro hostnames do painel (plano, §3). Um projeto só na Vercel; quem
 * separa é o subdomínio, resolvido aqui e aplicado no `proxy.ts`.
 *
 * · `app` — `goodbot.<domínio>`, o painel de sempre;
 * · `invite` / `demo` — os dois fluxos de convite (Etapa 2);
 * · `admin` — o painel do dono do bot: fila de aprovação, blocklist, saúde,
 *   broadcast e manutenção (Etapa 4).
 *
 * Este módulo é **puro de propósito**: ele roda no `proxy.ts`, que não pode
 * importar nada marcado como `server-only`. Quem precisa montar uma URL
 * absoluta usa `lib/site-url.ts`, que lê o ambiente.
 */
export const SITE_HOSTS = ['app', 'invite', 'demo', 'admin'] as const;
export type SiteHost = (typeof SITE_HOSTS)[number];

/** O header que o `proxy.ts` deixa na requisição para as páginas lerem. */
export const SITE_HOST_HEADER = 'x-goodbot-site';

const PREFIXES: Record<string, SiteHost> = {
  invite: 'invite',
  demo: 'demo',
  admin: 'admin',
};

/**
 * De qual dos hostnames veio esta requisição.
 *
 * A conta é pelo **primeiro rótulo** do host, não por uma lista de domínios em
 * variável: assim `invite.goodbot.dionatha.com.br`, `invite.goodbot.com.br` e
 * `invite.localhost:3000` classificam igual, e trocar de domínio não mexe em
 * código. O que continua vindo do ambiente é a URL absoluta (`AUTH_URL`), que
 * é o que o `redirect_uri` do Discord exige bater exatamente.
 *
 * Host desconhecido cai em `app`: o padrão seguro é o painel comum, que exige
 * sessão em toda tela.
 */
export function classifyHost(host: string | null | undefined): SiteHost {
  if (!host) return 'app';
  const hostname = host.split(':')[0]?.toLowerCase() ?? '';
  const first = hostname.split('.')[0] ?? '';
  return PREFIXES[first] ?? 'app';
}

/**
 * O host desta requisição. Prefere o que o `proxy.ts` já resolveu; sem ele
 * (uma rota fora do `matcher`, um teste), recai no header `Host`.
 */
export function siteFromHeaders(headers: { get(name: string): string | null }): SiteHost {
  const resolved = headers.get(SITE_HOST_HEADER);
  if (resolved && (SITE_HOSTS as readonly string[]).includes(resolved)) {
    return resolved as SiteHost;
  }
  return classifyHost(headers.get('host'));
}

/** O fluxo de convite deste host, ou `null` se ele não é um host de convite. */
export function inviteFlowOf(site: SiteHost): InviteFlow | null {
  if (site === 'invite') return 'invite';
  if (site === 'demo') return 'demo';
  return null;
}

/** O host que atende cada fluxo — o inverso de `inviteFlowOf`. */
export function hostOfInviteFlow(flow: InviteFlow): SiteHost {
  return flow === 'demo' ? 'demo' : 'invite';
}

/**
 * O mesmo host, servindo outro dos quatro papéis: troca o rótulo da frente.
 *
 * É o inverso de `classifyHost`, e existe porque duas telas precisam mandar o
 * visitante para um irmão do host atual sem saber qual é o domínio: o `/admin`
 * pedido no host do painel vai para `admin.` (o painel do dono tem um endereço
 * só), e quem chega sem sessão em `admin.` volta para o `/login` do painel —
 * onde o OAuth de fato acontece, porque é o `redirect_uri` que o Discord
 * conhece.
 *
 * Puro e pelo header `Host` como o resto deste módulo. É seguro justamente
 * porque só alimenta redirect: o pior caso é o cliente se mandar para um
 * endereço que ele mesmo escolheu. Onde isso **não** valeria — o `redirect_uri`
 * do OAuth — a URL vem do `AUTH_URL`, em `lib/site-url.ts`.
 */
export function hostForSite(host: string, target: SiteHost): string {
  const [hostname = '', porta] = host.split(':');
  const labels = hostname.split('.');
  // Só tira o primeiro rótulo se ele for um dos nossos: `goodbot.exemplo.com`
  // não pode virar `exemplo.com` por engano.
  if (labels.length > 1 && (labels[0] ?? '') in PREFIXES) labels.shift();
  const base = target === 'app' ? labels.join('.') : `${target}.${labels.join('.')}`;
  return porta === undefined ? base : `${base}:${porta}`;
}
