import 'server-only';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { currentSession } from './session';
import { actionLimiter, clientIp } from '@/lib/rate-limit';
import { servedGuildIds } from '@/lib/registry';

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
  access: 'read' | 'write' = 'read',
): Promise<{ session: GuildSession } | { verdict: DeniedVerdict }> {
  const session = await currentSession();
  if (!session?.user?.id) return { verdict: 'unauthenticated' };

  const requestHeaders = await headers();
  if (access === 'write' && !withinWriteBudget(session.user.id, requestHeaders))
    return { verdict: 'rate-limited' };

  // Guild que o bot não atende nem chega a consultar a API: uma URL inventada
  // não deve virar tráfego para o bot nem revelar se aquele servidor existe.
  if (!(await isConfiguredGuild(guildId))) return { verdict: 'denied' };

  const grant = session.guilds?.[guildId];
  let level = grant?.level ?? 'none';
  if (!grant || isStale(grant.checkedAt)) {
    // Leituras podem mostrar o último nível conhecido durante uma falha curta.
    // Uma escrita nunca usa nível vencido que não pôde ser revalidado.
    if (grant?.retryAfter && grant.retryAfter > Date.now()) {
      if (access === 'write') return { verdict: 'denied' };
    } else {
      try {
        level = await resolveGuildLevel(session.user.id, guildId);
      } catch {
        if (access === 'write') return { verdict: 'denied' };
        level = grant?.level ?? 'none';
      }
    }
  }

  const verdict = checkGuildAccess(
    {
      ...session,
      guilds: { ...session.guilds, [guildId]: { level, checkedAt: grant?.checkedAt ?? 0 } },
    },
    guildId,
    minimum,
  );
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
 * Guarda de leitura para server components, consultas e GET da guild.
 * Cada mutação usa `requireGuildWriteAccess` junto da escrita.
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

/** Guarda para toda mutação, independente do transporte escolhido pelo Next. */
export async function requireGuildWriteAccess(
  guildId: string,
  minimum: AccessLevel = 'mod',
): Promise<GuildSession> {
  const result = await resolveGuildSession(guildId, minimum, 'write');
  if ('session' in result) return result.session;
  if (result.verdict === 'unauthenticated') redirect('/login');
  redirect(result.verdict === 'rate-limited' ? '/denied?reason=rate-limit' : '/denied');
}

/**
 * Rate limit das **escritas** do painel (PRD §7.3). O gatilho é o header
 * Nenhum header do cliente decide se uma chamada é escrita: o call site usa
 * `requireGuildWriteAccess` explicitamente.
 */
function withinWriteBudget(
  userId: string,
  requestHeaders: Awaited<ReturnType<typeof headers>>,
): boolean {
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

/**
 * Todas as guilds que o painel gerencia. A fonte é o registro do banco
 * (`guild_registry`), não mais o `GUILD_IDS`: aprovar um servidor no painel
 * admin passa a valer sem redeploy.
 */
export async function configuredGuildIds(): Promise<string[]> {
  return servedGuildIds();
}

export async function isConfiguredGuild(guildId: string): Promise<boolean> {
  return (await servedGuildIds()).includes(guildId);
}
