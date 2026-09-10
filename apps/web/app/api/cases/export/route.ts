import { NextResponse } from 'next/server';

import { guildFromQuery } from '@/lib/auth/guild-param';
import { resolveGuildSession, verdictMessage, verdictStatus } from '@/lib/auth/require';
import { parseCaseFilters } from '@/lib/case-filters';
import { exportCasesCsv } from '@/lib/cases';

/**
 * Export dos casos em CSV (PRD §6.4). Recebe os mesmos parâmetros da tela, de
 * modo que o arquivo é exatamente o que está filtrado na tabela. Sem cache: é
 * um download, e cada um sai com um filtro diferente.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const guildId = await guildFromQuery(request.url);
  if (guildId === null) {
    return NextResponse.json({ error: 'Servidor não configurado.' }, { status: 404 });
  }

  const access = await resolveGuildSession(guildId);
  if ('verdict' in access) {
    return NextResponse.json(
      { error: verdictMessage(access.verdict) },
      { status: verdictStatus(access.verdict) },
    );
  }

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const csv = await exportCasesCsv(guildId, parseCaseFilters(params));
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="casos-${stamp}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
