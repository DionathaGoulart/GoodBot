import { NextResponse, type NextRequest } from 'next/server';

import { authLimiter, clientIp } from '@/lib/rate-limit';

/**
 * Duas responsabilidades:
 *
 * 1. **CSP com nonce.** O nonce muda a cada resposta, então a CSP não pode
 *    morar no `next.config.ts` (que só emite headers estáticos) — os demais
 *    headers de segurança ficam lá. O script de tema do `<head>` usa este
 *    mesmo nonce (`.harness/styleguide.md` §0.2, PRD §7.3).
 * 2. **Porta de `/g/*`.** Sem cookie de sessão nem adianta renderizar; a
 *    autorização de verdade é do `requireGuildAccess`, no servidor.
 * 3. **Rate limit de `/api/auth/*`.** O fluxo de OAuth é o único endpoint que
 *    responde a quem ainda não tem sessão; as escritas são limitadas mais
 *    adiante, no `requireGuildAccess` (PRD §7.3).
 *
 * O arquivo se chama `proxy.ts` porque o Next 16 aposentou `middleware.ts`;
 * a API é a mesma.
 */
export default function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/auth/')) {
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

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);

  if (request.nextUrl.pathname.startsWith('/g/') && !hasSessionCookie(request)) {
    const login = new URL('/login', request.url);
    login.searchParams.set('reason', 'expired');
    return NextResponse.redirect(login);
  }

  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
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
