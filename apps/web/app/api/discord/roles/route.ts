import { NextResponse } from 'next/server';

import { defaultGuildId, resolveGuildSession } from '@/lib/auth/require';
import { cachedInternalApi } from '@/lib/internal-api';

/** Cargos da guild para o `DiscordPicker` (§6.4). Cache curto: o bot já é a fonte viva. */
export const revalidate = 60;

export async function GET(): Promise<NextResponse> {
  const guildId = defaultGuildId();
  const access = await resolveGuildSession(guildId);
  if ('verdict' in access) {
    return NextResponse.json(
      { error: 'Sem acesso a esta guild.' },
      { status: access.verdict === 'unauthenticated' ? 401 : 403 },
    );
  }

  try {
    return NextResponse.json(await cachedInternalApi(60).roles(guildId));
  } catch {
    return NextResponse.json({ error: 'O bot não respondeu.' }, { status: 503 });
  }
}
