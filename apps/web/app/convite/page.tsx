import { DEMO_DURATION_MS, formatDuration, PENDING_EXPIRY_MS } from '@goodbot/shared';
import { headers } from 'next/headers';

import { inviteFlowOf, siteFromHeaders } from '@/lib/hosts';
import { siteUrl } from '@/lib/site-url';

import type { InviteFlow } from '@goodbot/shared';

export const metadata = { title: 'Convidar · Goodbot' };

/** Lê o host e o `AUTH_URL`; prerenderizar exigiria as duas coisas no build. */
export const dynamic = 'force-dynamic';

const ERROS: Record<string, string> = {
  cancelado: 'Você cancelou na tela do Discord. Nada foi alterado.',
  state:
    'O link expirou ou foi alterado no caminho. Comece de novo por esta página, ' +
    'sem guardar a URL do Discord.',
  code: 'O Discord não devolveu a autorização. Tente de novo.',
  discord: 'O Discord recusou a autorização. Tente de novo em alguns instantes.',
  guild: 'A resposta do Discord não bateu com o servidor autorizado. Nada foi alterado.',
  registro: 'A autorização funcionou, mas não conseguimos registrar o servidor. Tente de novo.',
};

const COPY: Record<InviteFlow, { kicker: string; titulo: string; texto: string; cta: string }> = {
  invite: {
    kicker: 'CONVITE',
    titulo: 'ADICIONAR',
    texto:
      'O Goodbot entra no seu servidor e fica em espera até o dono do bot aprovar. ' +
      'Enquanto isso ele não responde a comandos nem modera nada. Você recebe uma ' +
      'mensagem no privado quando entrar na fila e outra quando houver decisão; sem ' +
      `resposta em ${formatDuration(PENDING_EXPIRY_MS, { style: 'long' })}, o convite é ` +
      'recusado sozinho e o bot sai.',
    cta: 'ADICIONAR AO SERVIDOR',
  },
  demo: {
    kicker: 'DEMONSTRAÇÃO',
    titulo: 'TESTAR',
    texto:
      `O Goodbot entra funcionando e fica por ${formatDuration(DEMO_DURATION_MS, { style: 'long' })}. ` +
      'Você recebe os detalhes no privado assim que ele entrar, e um aviso antes de o prazo ' +
      'acabar. No fim ele se despede no servidor e sai sozinho. ' +
      'A demonstração vale uma vez por servidor.',
    cta: 'COMEÇAR A DEMONSTRAÇÃO',
  },
};

/**
 * A porta de entrada de `invite.` e `demo.`.
 *
 * É uma página com botão, e não um redirecionamento automático, por dois
 * motivos: a pessoa precisa saber **antes** que a demo tem prazo, e um link
 * que dispara o OAuth sozinho é consumido por qualquer prévia de link que o
 * Discord ou o WhatsApp gerem ao colar a URL.
 */
export default async function ConvitePage({ searchParams }: PageProps<'/convite'>) {
  const { erro } = await searchParams;
  const flow = inviteFlowOf(siteFromHeaders(await headers()));
  const mensagem = typeof erro === 'string' ? ERROS[erro] : undefined;

  return (
    <main className="screen-pad flex flex-1 flex-col items-center justify-center gap-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="screen-kicker sigil">{flow ? COPY[flow].kicker : 'GOODBOT'}</p>
        <h1 className="screen-title text-5xl underline decoration-accent decoration-4 underline-offset-4 md:text-6xl">
          {flow ? COPY[flow].titulo : 'GOODBOT'}
        </h1>
        <p className="max-w-prose text-sm opacity-70">
          {flow ? COPY[flow].texto : 'Escolha por onde quer começar.'}
        </p>
      </div>

      {mensagem ? (
        <p
          role="alert"
          className="max-w-prose border-2 border-error bg-base-200 px-4 py-3 text-sm text-error-text"
        >
          {mensagem}
        </p>
      ) : null}

      {flow ? (
        <>
          <a className="btn-goodchat" href="/api/invite/start">
            {COPY[flow].cta}
          </a>
          <p className="max-w-prose text-center text-xs opacity-60">
            Você precisa da permissão <strong>Gerenciar Servidor</strong> no servidor que escolher.
          </p>
        </>
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <a className="btn-goodchat" href={siteUrl('invite')}>
            ADICIONAR AO SERVIDOR
          </a>
          <a className="btn-goodchat-outline" href={siteUrl('demo')}>
            TESTAR POR {formatDuration(DEMO_DURATION_MS)}
          </a>
        </div>
      )}
    </main>
  );
}
