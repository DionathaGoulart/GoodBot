import { signInWithDiscord } from '@/app/actions/auth';

export const metadata = { title: 'Entrar · CoBot' };

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const { reason } = await searchParams;

  return (
    <main className="screen-pad flex flex-1 flex-col items-center justify-center gap-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="screen-kicker sigil">COBOT</p>
        <h1 className="screen-title text-5xl underline decoration-accent decoration-4 underline-offset-4 md:text-6xl">
          PAINEL
        </h1>
        <p className="max-w-prose text-sm opacity-70">
          Entre com a conta do Discord que administra o servidor.
        </p>
      </div>

      {reason === 'expired' ? (
        <p
          role="status"
          className="border-2 border-info bg-base-200 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-info"
        >
          ! SESSÃO EXPIRADA
        </p>
      ) : null}

      <form action={signInWithDiscord}>
        <button type="submit" className="btn-goodchat">
          ENTRAR COM DISCORD
        </button>
      </form>
    </main>
  );
}
