import 'server-only';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { env } from '@/lib/env';
import { actionLimiter, clientIp } from '@/lib/rate-limit';

import { checkGuildAccess, type AccessLevel } from './access';
import { isStale, resolveGuildLevel } from './resolve';

export interface GuildSession {
  user: { id: string; name: string; image: string | null };
  level: AccessLevel;
  guildId: string;
}

/**
 * Como `requireGuildAccess`, mas devolve o veredito em vez de redirecionar —
 * é o que os route handlers de `/api/*` usam, porque um `redirect` viraria um
 * HTML de login no meio de um `fetch` que espera JSON.
 */
export async function resolveGuildSession(
  guildId: string,
  minimum: AccessLevel = 'mod',
): Promise<{ session: GuildSession } | { verdict: DeniedVerdict }> {
  const session = await auth();
  if (!session?.user?.id) return { verdict: 'unauthenticated' };

  if (!(await withinWriteBudget(session.user.id))) return { verdict: 'rate-limited' };

  let level = session.level;
  if (isStale(session.checkedAt)) {
    level = await resolveGuildLevel(session.user.id);
  }

  const verdict = checkGuildAccess({ ...session, level }, guildId, minimum);
  if (verdict !== 'ok') return { verdict };

  return {
    session: {
      user: {
        id: session.user.id,
        name: session.user.name ?? 'desconhecido',
        image: session.user.image ?? null,
      },
      level,
      guildId,
    },
  };
}

/**
 * Porta de entrada de **todo** server component, action e route handler que
 * toca em dados da guild (PRD §7.3) — não basta checar no layout. Se a
 * permissão está velha (§6, 15 min), reconfirma com o bot antes de decidir.
 */
export async function requireGuildAccess(
  guildId: string,
  minimum: AccessLevel = 'mod',
): Promise<GuildSession> {
  const result = await resolveGuildSession(guildId, minimum);
  if ('session' in result) return result.session;
  if (result.verdict === 'unauthenticated') redirect('/login');
  redirect(result.verdict === 'rate-limited' ? '/denied?reason=rate-limit' : '/denied');
}

/**
 * Rate limit das **escritas** do painel (PRD §7.3). O gatilho é o header
 * `next-action`, que o Next só manda numa server action — assim navegar pelas
 * páginas nunca gasta o balde, e toda action passa por aqui sem que nenhum
 * call site precise lembrar de chamar o limitador.
 */
async function withinWriteBudget(userId: string): Promise<boolean> {
  const requestHeaders = await headers();
  if (!requestHeaders.get('next-action')) return true;
  return actionLimiter.hit(`${clientIp(requestHeaders)}:${userId}`).allowed;
}

/** Veredito negado → status HTTP, para os route handlers de `/api/*`. */
export type DeniedVerdict = 'unauthenticated' | 'denied' | 'rate-limited';

export function verdictStatus(verdict: DeniedVerdict): 401 | 403 | 429 {
  if (verdict === 'unauthenticated') return 401;
  return verdict === 'rate-limited' ? 429 : 403;
}

export function verdictMessage(verdict: DeniedVerdict): string {
  return verdict === 'rate-limited'
    ? 'Muitas requisições; espere um minuto.'
    : 'Sem acesso a esta guild.';
}

/** Guild única hoje (PRD §7.1); a rota já é `/g/[guildId]` para o dia em que não for. */
export function defaultGuildId(): string {
  return env().GUILD_ID;
}
