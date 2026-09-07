import { NextResponse } from 'next/server';

/**
 * Health check do painel (PRD §7.5). Público e deliberadamente burro: só diz
 * que a instância na Vercel está de pé e servindo. Nada de banco ou de API do
 * bot aqui — quem quiser o estado do bot usa `GET /health` da API dele, que
 * também responde sem token.
 */
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json(
    { ok: true, service: 'web', timestamp: new Date().toISOString() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
