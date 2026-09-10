import 'server-only';

import { BOT_INVITE_PERMISSIONS, isSnowflake, type InviteFlow } from '@goodbot/shared';
import { z } from 'zod';

import { env } from '@/lib/env';
import { hostOfInviteFlow } from '@/lib/hosts';
import { siteUrl } from '@/lib/site-url';

const DISCORD_API = 'https://discord.com/api/v10';
const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';

/** O caminho do callback, igual nos dois hosts (plano, §3.3). */
export const INVITE_CALLBACK_PATH = '/api/invite/callback';

/**
 * `identify` acompanha `bot` para sabermos **quem** convidou (`invitedBy` no
 * registro, e a fila de aprovação precisa disso). O token que sai
 * daí é usado uma vez, no callback, e descartado — nada é guardado.
 */
const SCOPES = ['bot', 'applications.commands', 'identify'] as const;

/** O `redirect_uri` deste fluxo. Fixo pelo `AUTH_URL`, nunca pelo header. */
export function inviteRedirectUri(flow: InviteFlow): string {
  return siteUrl(hostOfInviteFlow(flow), INVITE_CALLBACK_PATH);
}

/**
 * A URL do OAuth que instala o bot num servidor. `integration_type=0` fixa a
 * instalação **em servidor** (a alternativa é o app instalado no usuário, que
 * não é o produto), e `response_type=code` é o que faz o Discord devolver o
 * `guild_id` para nós — sem isso não há como saber onde ele entrou.
 */
export function inviteAuthorizeUrl(flow: InviteFlow, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', env().DISCORD_CLIENT_ID);
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('permissions', BOT_INVITE_PERMISSIONS);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', inviteRedirectUri(flow));
  url.searchParams.set('state', state);
  url.searchParams.set('integration_type', '0');
  return url.toString();
}

const TokenSchema = z.object({
  access_token: z.string().min(1),
  // Presente justamente porque o escopo `bot` foi usado.
  guild: z.object({ id: z.string(), name: z.string().optional() }).optional(),
});

const UserSchema = z.object({ id: z.string() });

export interface InviteAuthorization {
  guildId: string;
  guildName: string | null;
  /** Quem clicou no convite, ou `null` se o Discord não quis dizer. */
  invitedBy: string | null;
}

/**
 * Troca o `code` do callback pelo token e confirma o que aconteceu.
 *
 * Poderíamos confiar só no `guild_id` da query, mas ele é um parâmetro de URL:
 * qualquer um monta um. A troca do `code` é a prova de que a instalação de
 * fato ocorreu, e de quebra devolve o nome do servidor e a identidade de quem
 * convidou. Devolve `null` quando o Discord recusa — código já usado, expirado
 * ou de outro cliente.
 */
export async function exchangeInviteCode(
  code: string,
  flow: InviteFlow,
): Promise<InviteAuthorization | null> {
  const config = env();

  const response = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.DISCORD_CLIENT_ID,
      client_secret: config.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: inviteRedirectUri(flow),
    }),
    cache: 'no-store',
  });
  if (!response.ok) return null;

  const token = TokenSchema.safeParse(await response.json());
  if (!token.success) return null;

  const guildId = token.data.guild?.id;
  if (!guildId || !isSnowflake(guildId)) return null;

  return {
    guildId,
    guildName: token.data.guild?.name ?? null,
    invitedBy: await fetchInviter(token.data.access_token),
  };
}

/**
 * Quem autorizou. Falhar aqui não invalida o convite: o registro aguenta
 * `invitedBy` nulo (é o caso das linhas semeadas pelo `GUILD_IDS`), e perder o
 * nome de quem clicou não é motivo para recusar um servidor.
 */
async function fetchInviter(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const user = UserSchema.safeParse(await response.json());
    return user.success && isSnowflake(user.data.id) ? user.data.id : null;
  } catch {
    return null;
  }
}
