import 'server-only';

import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { env } from '@/lib/env';

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
): Promise<{ session: GuildSession } | { verdict: 'unauthenticated' | 'denied' }> {
  const session = await auth();
  if (!session?.user?.id) return { verdict: 'unauthenticated' };

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
  redirect(result.verdict === 'unauthenticated' ? '/login' : '/denied');
}

/** Guild única hoje (PRD §7.1); a rota já é `/g/[guildId]` para o dia em que não for. */
export function defaultGuildId(): string {
  return env().GUILD_ID;
}
