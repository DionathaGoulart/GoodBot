import { signOutAction } from '@/app/actions/auth';

export const metadata = { title: 'Acesso negado · CoBot' };

/** §8 — sem permissão: tela inteira, explicação e o botão de sair. */
export default function DeniedPage() {
  return (
    <main className="screen-pad flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <p className="screen-kicker sigil">COBOT</p>
      <h1 className="screen-title text-4xl md:text-5xl">ACESSO NEGADO</h1>
      <p className="max-w-prose text-sm opacity-70">
        Sua conta não é membro do servidor configurado ou não tem permissão para usar o painel. Peça
        a um administrador para liberar um cargo de acesso e entre de novo.
      </p>
      <form action={signOutAction}>
        <button type="submit" className="btn-goodchat-outline">
          SAIR
        </button>
      </form>
    </main>
  );
}
