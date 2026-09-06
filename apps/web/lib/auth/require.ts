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
 * Porta de entrada de **todo** server component, action e route handler que
 * toca em dados da guild (PRD §7.3) — não basta checar no layout. Se a
 * permissão está velha (§6, 15 min), reconfirma com o bot antes de decidir.
 */
export async function requireGuildAccess(
  guildId: string,
  minimum: AccessLevel = 'mod',
): Promise<GuildSession> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  let level = session.level;
  if (isStale(session.checkedAt)) {
    level = await resolveGuildLevel(session.user.id);
  }

  const verdict = checkGuildAccess({ ...session, level }, guildId, minimum);
  if (verdict === 'unauthenticated') redirect('/login');
  if (verdict === 'denied') redirect('/denied');

  return {
    user: {
      id: session.user.id,
      name: session.user.name ?? 'desconhecido',
      image: session.user.image ?? null,
    },
    level,
    guildId,
  };
}

/** Guild única hoje (PRD §7.1); a rota já é `/g/[guildId]` para o dia em que não for. */
export function defaultGuildId(): string {
  return env().GUILD_ID;
}
