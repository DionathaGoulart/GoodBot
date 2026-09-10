import { NextResponse } from 'next/server';

import { inviteFlowOf, siteFromHeaders } from '@/lib/hosts';
import { inviteAuthorizeUrl } from '@/lib/invite/discord';
import { signInviteState } from '@/lib/invite/state';
import { siteUrl } from '@/lib/site-url';

/**
 * O começo do convite: assina o `state` e manda para o OAuth do Discord.
 *
 * É uma rota, e não um link montado na página, porque o `state` vale poucos
 * minutos (`INVITE_STATE_TTL_MS`): gerado no clique, ele nunca chega vencido
 * por causa de uma aba esquecida aberta.
 *
 * Qual fluxo é este vem do **host** (`invite.` ou `demo.`), não da query. Não
 * é uma barreira de segurança — qualquer um pode abrir o `demo.` — mas mantém
 * um único lugar decidindo, e é ele que assina o `state`.
 */
export const dynamic = 'force-dynamic';

export function GET(request: Request): NextResponse {
  const flow = inviteFlowOf(siteFromHeaders(request.headers));
  if (!flow) {
    return NextResponse.redirect(siteUrl('app', '/convite'), { status: 303 });
  }

  return NextResponse.redirect(inviteAuthorizeUrl(flow, signInviteState(flow)), {
    status: 303,
    headers: { 'cache-control': 'no-store' },
  });
}
