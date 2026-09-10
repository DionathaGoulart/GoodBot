import { NextResponse, type NextRequest } from 'next/server';

import { classifyHost, hostForSite, SITE_HOST_HEADER, type SiteHost } from '@/lib/hosts';
import { authLimiter, clientIp } from '@/lib/rate-limit';

/**
 * Quatro responsabilidades:
 *
 * 1. **CSP com nonce.** O nonce muda a cada resposta, então a CSP não pode
 *    morar no `next.config.ts` (que só emite headers estáticos) — os demais
 *    headers de segurança ficam lá. O script de tema do `<head>` usa este
 *    mesmo nonce (`.harness/styleguide.md` §0.2, PRD §7.3).
 * 2. **Porta de `/g/*`.** Sem cookie de sessão nem adianta renderizar; a
 *    autorização de verdade é do `requireGuildAccess`, no servidor.
 * 3. **Rate limit de `/api/auth/*` e `/api/invite/*`.** São os endpoints que
 *    respondem a quem ainda não tem sessão; as escritas são limitadas mais
 *    adiante, no `requireGuildAccess` (PRD §7.3).
 * 4. **Roteamento por hostname.** Um projeto só na Vercel serve os quatro
 *    domínios (plano, §3); quem separa é o subdomínio, resolvido aqui.
 *
 * O arquivo se chama `proxy.ts` porque o Next 16 aposentou `middleware.ts`;
 * a API é a mesma.
 */
export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/auth/') || pathname.startsWith('/api/invite/')) {
    const hit = authLimiter.hit(clientIp(request.headers));
    if (!hit.allowed) {
      return NextResponse.json(
        { error: 'Muitas tentativas; espere um minuto.' },
        { status: 429, headers: { 'retry-after': String(hit.retryAfter) } },
      );
    }
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';

  const csp = [
    "default-src 'self'",
    // `unsafe-eval` só no dev: o Turbopack precisa dele para o HMR.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // O Tailwind injeta estilos no dev e o Next usa `style` inline em produção.
    "style-src 'self' 'unsafe-inline'",
    // Avatares e ícones do Discord, e o avatar do canal e a capa do vídeo que
    // o módulo social resolve no YouTube (PRD §5.8) — o painel mostra os dois
    // direto da origem, sem proxy.
    "img-src 'self' data: https://cdn.discordapp.com https://yt3.googleusercontent.com https://yt3.ggpht.com https://i.ytimg.com",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');

  const site = classifyHost(request.headers.get('host'));
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set(SITE_HOST_HEADER, site);

  const withCsp = (response: NextResponse): NextResponse => {
    response.headers.set('Content-Security-Policy', csp);
    return response;
  };

  if (site !== 'app') {
    const destino = rotaDoHost(site, pathname);
    if (destino === null) {
      return withCsp(NextResponse.redirect(new URL('/', request.url)));
    }
    if (destino !== pathname) {
      return withCsp(NextResponse.rewrite(new URL(destino, request.url), { request: { headers } }));
    }
  }

  // O painel do dono tem um endereço só. Chegar em `/admin` pelo host do painel
  // comum é bookmark antigo ou link errado, não um segundo caminho — manda para
  // o lugar certo em vez de servir a mesma tela em dois endereços.
  if (site === 'app' && pathname.startsWith('/admin')) {
    return withCsp(NextResponse.redirect(adminUrl(request)));
  }

  // Sem cookie nem adianta renderizar (a autorização de verdade é do
  // `requireGuildAccess` e do `requireBotOwner`, no servidor). O `/admin` entra
  // na conta pelo host `admin`, que é o único onde ele existe: sem esta linha o
  // painel do dono seria a única tela logada que renderiza o casco antes de
  // saber se há sessão.
  const painel =
    site === 'app' &&
    (pathname === '/' || pathname.startsWith('/servidores') || pathname.startsWith('/g/'));
  const admin = site === 'admin' && pathname.startsWith('/admin');
  if (painel || admin) {
    if (!hasSessionCookie(request)) return withCsp(NextResponse.redirect(loginUrl(request, site)));
  }

  return withCsp(NextResponse.next({ request: { headers } }));
}

/**
 * O que cada subdomínio serve. Devolve o caminho a servir, ou `null` para
 * mandar de volta à raiz do próprio host.
 *
 * A regra é fechada de propósito: `invite.` e `demo.` existem para uma coisa
 * só, e um `/g/<id>` respondendo neles seria o painel inteiro exposto num
 * hostname que não deveria ter sessão. `admin.` serve só `/admin`, e o painel
 * comum não serve `/admin` nenhum: separar o dono do bot dos donos de servidor
 * é o ponto inteiro da tela, e um hostname a menos para confundir ajuda.
 */
function rotaDoHost(site: Exclude<SiteHost, 'app'>, pathname: string): string | null {
  // A autenticação e o próprio fluxo de convite valem em todos os hosts.
  if (pathname.startsWith('/api/')) return pathname;

  if (site === 'admin') {
    return pathname === '/' ? '/admin' : pathname.startsWith('/admin') ? pathname : null;
  }

  if (pathname === '/') return '/convite';
  return pathname.startsWith('/convite') ? pathname : null;
}

/**
 * Para onde mandar quem chegou sem sessão.
 *
 * Do host `admin.` a resposta **não** é o `/login` de lá: aquele host serve só
 * `/admin*`, então `/login` voltaria para a raiz, que reescreve para `/admin`,
 * que redireciona para `/login` — um laço. E não é só a rota: o login é OAuth,
 * e o `redirect_uri` registrado no Discord aponta para o host do painel. Existe
 * um lugar de entrar, e é lá; o cookie de sessão vale nos dois porque sai com
 * `domain` do host do painel (ver `auth.ts`).
 */
function loginUrl(request: NextRequest, site: SiteHost): URL {
  const url = new URL('/login', request.url);
  if (site !== 'app') url.host = hostForSite(url.host, 'app');
  url.searchParams.set('reason', 'expired');
  return url;
}

/** O mesmo endereço no host do painel do dono (ver `hostForSite`). */
function adminUrl(request: NextRequest): URL {
  const url = new URL(request.url);
  url.host = hostForSite(url.host, 'admin');
  return url;
}

/** Auth.js prefixa o cookie com `__Secure-` quando serve por HTTPS. */
function hasSessionCookie(request: NextRequest): boolean {
  return (
    request.cookies.has('authjs.session-token') ||
    request.cookies.has('__Secure-authjs.session-token')
  );
}

export const config = {
  // Tudo que é página; arquivos estáticos e imagens ficam de fora.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|woff2?)$).*)'],
};
