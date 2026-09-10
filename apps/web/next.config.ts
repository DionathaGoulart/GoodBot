import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { NextConfig } from 'next';

/**
 * Carrega o `.env` da raiz do monorepo. O Next só enxerga `.env` dentro de
 * `apps/web`, e o projeto mantém um arquivo só (CLAUDE.md). Feito à mão, sem
 * lib, e aqui no config porque todo processo do Next (CLI, workers de build,
 * servidor) reavalia este arquivo. Na Vercel o arquivo não existe e as
 * variáveis vêm do projeto.
 */
function loadRootEnv(): void {
  const file = resolve(process.cwd(), '../../.env');
  if (!existsSync(file)) return;

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    const key = match?.[1];
    const raw = match?.[2];
    if (key === undefined || raw === undefined) continue;
    // `NODE_ENV` é do Next: quem manda é o comando (`dev` vs `build`).
    if (key === 'NODE_ENV' || process.env[key] !== undefined) continue;
    process.env[key] = raw.trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

loadRootEnv();

/**
 * Headers estáticos de segurança (PRD §7.3). A CSP **não** está aqui: ela
 * carrega um nonce por resposta e é montada no `proxy.ts`.
 *
 * O painel vai para a Vercel (Etapa 19), sem Caddy na frente — então estes
 * headers são responsabilidade do Next, e nada de `output: 'standalone'`.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const nextConfig: NextConfig = {
  // Pacotes do workspace são consumidos direto do fonte (TypeScript).
  transpilePackages: ['@goodbot/shared', '@goodbot/db'],
  experimental: {
    /**
     * Sem isto, um pedido RSC que falha na rede vira navegação de página
     * inteira: o router do Next devolve a própria URL como se fosse um
     * redirecionamento externo e o browser recarrega no `location.href`
     * (`fetch-server-response.ts`: "If fetch fails handle it like a mpa
     * navigation"). No celular isso acontece toda vez que o painel revalida
     * com o rádio ainda voltando — a recarga também falha e o Chrome mostra
     * a própria tela de erro, que só o F5 tira. Com `useOffline` o router
     * espera a conexão voltar e refaz o pedido, sem sair da página.
     */
    useOffline: true,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
