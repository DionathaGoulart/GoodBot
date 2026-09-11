import { formatDuration, isSnowflake, PENDING_EXPIRY_MS } from '@goodbot/shared';

import { guildOutcome, type InviteOutcome } from '@/lib/invite/register';
import { siteUrl } from '@/lib/site-url';

export const metadata = { title: 'Pronto · Goodbot' };

/** O estado sai do registro no banco; nada aqui pode ser prerenderizado. */
export const dynamic = 'force-dynamic';

/**
 * O produto é brasileiro e a página não tem JavaScript: fixar o fuso é o que
 * faz "até 14:35" significar a mesma coisa para quem lê e para quem opera.
 */
const FUSO = 'America/Sao_Paulo';

/** O prazo da fila, escrito do mesmo jeito em toda a tela. */
const PRAZO_DA_FILA = formatDuration(PENDING_EXPIRY_MS, { style: 'long' });

function horario(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

interface Copy {
  kicker: string;
  titulo: string;
  texto: string;
  acao?: { label: string; href: string; outline?: boolean };
}

function copyDe(outcome: InviteOutcome, now: Date): Copy {
  switch (outcome.kind) {
    case 'demo':
      return {
        kicker: 'DEMONSTRAÇÃO ATIVA',
        titulo: 'NO AR',
        texto:
          `O Goodbot já está moderando o seu servidor até ${horario(outcome.expiresAt)} ` +
          `(${formatDuration(outcome.expiresAt.getTime() - now.getTime(), { style: 'long' })}). ` +
          'Ele avisa no servidor antes de sair. Para ficar de vez, peça a aprovação pelo convite normal.',
        acao: { label: 'PEDIR APROVAÇÃO', href: siteUrl('invite'), outline: true },
      };
    case 'pending':
      return {
        kicker: 'NA FILA',
        titulo: 'AGUARDANDO',
        texto:
          'O Goodbot entrou no servidor e está em espera. Ele não responde a comandos nem ' +
          'modera nada até o dono do bot aprovar. Pode deixar o bot lá, nada se perde. ' +
          `Avisamos no seu privado assim que for aprovado; sem decisão em ${PRAZO_DA_FILA}, ` +
          'o convite é recusado sozinho e dá para convidar de novo.',
      };
    case 'approved':
      return {
        kicker: 'APROVADO',
        titulo: 'TUDO CERTO',
        texto: 'Este servidor já é atendido. Abra o painel para configurar os módulos.',
        acao: { label: 'ABRIR O PAINEL', href: siteUrl('app') },
      };
    case 'blocked':
      return {
        kicker: 'BLOQUEADO',
        titulo: 'SEM ACESSO',
        texto:
          'Este servidor está bloqueado e o Goodbot não vai atendê-lo. ' +
          'Se acha que é engano, fale com quem administra o bot.',
      };
    case 'demo-vencida':
      return {
        kicker: 'DEMONSTRAÇÃO USADA',
        titulo: 'PRAZO ENCERRADO',
        texto:
          'Este servidor já usou a demonstração, e ela não se renova. O convite entrou na ' +
          'fila de aprovação como qualquer outro, e avisamos no seu privado quando houver ' +
          'decisão. Pode deixar o bot lá.',
      };
    case 'expirado':
      return {
        kicker: 'CONVITE RECUSADO',
        titulo: 'PRAZO DA FILA',
        texto:
          `Este convite ficou ${PRAZO_DA_FILA} na fila sem ser aprovado, então foi recusado ` +
          'sozinho e o bot saiu. Isto não é um bloqueio: convidar de novo funciona, e a fila ' +
          'recomeça do zero.',
        acao: { label: 'CONVIDAR DE NOVO', href: siteUrl('invite'), outline: true },
      };
    case 'desconhecido':
      return {
        kicker: 'NÃO ENCONTRADO',
        titulo: 'SEM REGISTRO',
        texto:
          'Não achamos este servidor no registro. Se você acabou de convidar o bot, ' +
          'comece de novo pelo link do convite.',
        acao: { label: 'COMEÇAR DE NOVO', href: siteUrl('invite'), outline: true },
      };
  }
}

/**
 * A tela de destino do convite: diz o que aconteceu de verdade.
 *
 * O que ela mostra vem do **registro**, não da query — o `g` é só o servidor a
 * consultar. Assim ninguém "vira aprovado" trocando um parâmetro na URL, e a
 * página continua correta se a pessoa recarregar meia hora depois.
 */
export default async function ConvitePronto({ searchParams }: PageProps<'/convite/pronto'>) {
  const { g } = await searchParams;
  const guildId = typeof g === 'string' && isSnowflake(g) ? g : null;
  const now = new Date();
  const outcome: InviteOutcome = guildId ? await guildOutcome(guildId) : { kind: 'desconhecido' };
  const copy = copyDe(outcome, now);

  return (
    <main className="screen-pad flex flex-1 flex-col items-center justify-center gap-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="screen-kicker sigil">{copy.kicker}</p>
        <h1 className="screen-title text-4xl underline decoration-accent decoration-4 underline-offset-4 md:text-5xl">
          {copy.titulo}
        </h1>
        <p className="max-w-prose text-sm opacity-70">{copy.texto}</p>
      </div>

      {copy.acao ? (
        <a
          className={copy.acao.outline ? 'btn-goodchat-outline' : 'btn-goodchat'}
          href={copy.acao.href}
        >
          {copy.acao.label}
        </a>
      ) : null}

      {guildId ? <p className="screen-meta select-all">SERVIDOR {guildId}</p> : null}
    </main>
  );
}
