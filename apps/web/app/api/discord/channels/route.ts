import { NextResponse } from 'next/server';

import { resolveGuildSession, verdictMessage, verdictStatus } from '@/lib/auth/require';
import { guildFromQuery } from '@/lib/auth/guild-param';
import { cachedInternalApi } from '@/lib/internal-api';

/**
 * Canais da guild para o `DiscordPicker` (§6.4). Cache curto: o bot já é a
 * fonte viva, e quem guarda os 60s é o `cachedInternalApi` abaixo.
 *
 * `force-dynamic` é obrigatório: a rota lê a sessão, então prerenderizá-la no
 * build faria o `env()` rodar sem as variáveis e derrubar o `next build`.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const guildId = guildFromQuery(request.url);
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

  try {
    return NextResponse.json(await cachedInternalApi(60).channels(guildId));
  } catch {
    return NextResponse.json({ error: 'O bot não respondeu.' }, { status: 503 });
  }
}
