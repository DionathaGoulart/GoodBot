import { NextResponse } from 'next/server';

import { inviteFlowOf, siteFromHeaders } from '@/lib/hosts';
import { exchangeInviteCode } from '@/lib/invite/discord';
import { registerInvitedGuild } from '@/lib/invite/register';
import { verifyInviteState } from '@/lib/invite/state';
import { siteUrl } from '@/lib/site-url';

/**
 * A volta do OAuth de convite (plano, Etapa 2).
 *
 * O Discord manda `code`, `guild_id` e o nosso `state`. A ordem das checagens
 * é a ordem da confiança:
 *
 * 1. o `state` tem de ter a nossa assinatura e estar no prazo — é ele que diz
 *    se o servidor entra como `pending` ou como `demo`;
 * 2. o fluxo do `state` tem de bater com o host que recebeu o callback. O
 *    Discord só redireciona para o `redirect_uri` registrado do fluxo, então
 *    divergência aqui é sinal de `state` reaproveitado;
 * 3. o `code` é trocado com o Discord. É essa troca — e não o `guild_id` da
 *    query, que qualquer um digita — que prova que a instalação aconteceu.
 *
 * Falhar em qualquer uma volta para `/convite` com o motivo; nada é gravado.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  // O destino sai do `AUTH_URL`, não do `request.url`: no `next start` a URL da
  // requisição vem do endereço em que o processo escuta, e não do `Host` — o
  // que jogaria quem veio de `demo.` de volta no host do painel.
  const site = siteFromHeaders(request.headers);
  const recusa = (motivo: string): NextResponse =>
    NextResponse.redirect(siteUrl(site, `/convite?erro=${motivo}`), { status: 303 });

  // A pessoa clicou em "Cancelar" na tela do Discord.
  if (url.searchParams.get('error')) return recusa('cancelado');

  const state = verifyInviteState(url.searchParams.get('state'));
  if (!state) return recusa('state');
  if (state.flow !== inviteFlowOf(site)) return recusa('state');

  const code = url.searchParams.get('code');
  if (!code) return recusa('code');

  let authorization;
  try {
    authorization = await exchangeInviteCode(code, state.flow);
  } catch {
    return recusa('discord');
  }
  if (!authorization) return recusa('discord');

  // O `guild_id` da query é redundante com o da troca do `code`; divergir
  // significa que alguém mexeu na URL no meio do caminho.
  const fromQuery = url.searchParams.get('guild_id');
  if (fromQuery && fromQuery !== authorization.guildId) return recusa('guild');

  try {
    await registerInvitedGuild({
      guildId: authorization.guildId,
      flow: state.flow,
      invitedBy: authorization.invitedBy,
    });
  } catch {
    return recusa('registro');
  }

  const destino = new URL(siteUrl(site, '/convite/pronto'));
  destino.searchParams.set('g', authorization.guildId);
  return NextResponse.redirect(destino, { status: 303 });
}
