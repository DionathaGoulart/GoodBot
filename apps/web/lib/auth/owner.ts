import 'server-only';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { env } from '@/lib/env';
import { actionLimiter, clientIp } from '@/lib/rate-limit';
import { siteUrl } from '@/lib/site-url';

/**
 * A porta do painel do dono do bot (`admin.<domínio>`, plano, Etapa 4).
 *
 * O nível aqui **não** vem do Discord: ser dono, admin ou moderador de um
 * servidor não diz nada sobre ser dono do bot — se dissesse, qualquer um que
 * convidasse o Goodbot para o próprio servidor poderia expulsá-lo dos outros.
 * Quem decide é uma variável de ambiente e só ela.
 *
 * Sem `OWNER_DISCORD_ID` no ambiente ninguém entra. Fechado por ausência é a
 * única leitura possível de uma variável faltando: o contrário transformaria
 * um `.env` incompleto em painel admin aberto.
 */
export interface OwnerSession {
  user: { id: string; name: string; image: string | null };
}

export type OwnerVerdict = 'ok' | 'unauthenticated' | 'denied' | 'not-configured' | 'rate-limited';

/** O veredito, sem redirecionar — é o que as rotas de `/api/*` precisam. */
export async function resolveOwnerSession(): Promise<
  { session: OwnerSession } | { verdict: Exclude<OwnerVerdict, 'ok'> }
> {
  const ownerId = env().OWNER_DISCORD_ID;
  if (!ownerId) return { verdict: 'not-configured' };

  const session = await auth();
  if (!session?.user?.id) return { verdict: 'unauthenticated' };

  if (!(await withinWriteBudget(session.user.id))) return { verdict: 'rate-limited' };

  // Comparação simples e não em tempo constante de propósito: o ID do dono não
  // é segredo (qualquer um num servidor dele consegue), e o que ele protege é
  // a identidade já provada pelo login do Discord, não um token.
  if (session.user.id !== ownerId) return { verdict: 'denied' };

  return {
    session: {
      user: {
        id: session.user.id,
        name: session.user.name ?? 'desconhecido',
        image: session.user.image ?? null,
      },
    },
  };
}

/**
 * Porta de entrada de **toda** página e action do `/admin`. Como no painel
 * comum, não basta checar no layout: cada action passa por aqui de novo.
 *
 * Os destinos são **absolutos, no host do painel**, e não relativos como no
 * resto do projeto. O motivo é que este código roda em `admin.<host>`, que
 * serve só `/admin*`: um `redirect('/login')` relativo cairia na raiz de lá,
 * que reescreve para `/admin`, que redireciona de novo — laço. Entrar é no
 * host do painel de qualquer forma, porque é o único `redirect_uri` que o
 * Discord conhece.
 */
export async function requireBotOwner(): Promise<OwnerSession> {
  const result = await resolveOwnerSession();
  if ('session' in result) return result.session;
  if (result.verdict === 'unauthenticated') redirect(siteUrl('app', '/login'));
  redirect(
    siteUrl('app', result.verdict === 'rate-limited' ? '/denied?reason=rate-limit' : '/denied'),
  );
}

/** O painel admin está configurado neste deploy? Usado só para explicar a tela. */
export function isAdminConfigured(): boolean {
  return env().OWNER_DISCORD_ID !== undefined;
}

/**
 * O mesmo balde de escrita do painel comum (PRD §7.3): o gatilho é o header
 * `next-action`, que só existe numa server action, então navegar entre as
 * telas do admin nunca gasta cota.
 */
async function withinWriteBudget(userId: string): Promise<boolean> {
  const requestHeaders = await headers();
  if (!requestHeaders.get('next-action')) return true;
  return actionLimiter.hit(`${clientIp(requestHeaders)}:${userId}`).allowed;
}
