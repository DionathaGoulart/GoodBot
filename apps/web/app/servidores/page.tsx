import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AvatarSq } from '@/components/retro/avatar-sq';
import { Tag } from '@/components/retro/tag';
import { currentSession } from '@/lib/auth/session';
import { listAccessibleGuilds } from '@/lib/guilds';
import { siteUrl } from '@/lib/site-url';

import type { AccessLevel } from '@/lib/auth/access';

export const metadata = { title: 'Servidores · Goodbot' };

/** A lista sai da sessão e do registro; nada aqui pode ser prerenderizado. */
export const dynamic = 'force-dynamic';

const NIVEL: Record<Exclude<AccessLevel, 'none'>, string> = {
  owner: 'DONO',
  admin: 'ADMIN',
  mod: 'MODERAÇÃO',
};

/**
 * O seletor de servidor. É a tela de pouso de quem entra com acesso a mais de
 * um servidor, e o destino do ícone da topbar.
 *
 * Ele mostra só o que **este usuário** pode abrir: a lista vem de
 * `listAccessibleGuilds`, filtrada pelo nível por guild da sessão.
 */
export default async function ServidoresPage() {
  const session = await currentSession();
  if (!session?.user?.id) redirect('/login');

  const guilds = await listAccessibleGuilds();

  return (
    <main className="screen-pad flex flex-1 flex-col items-center justify-center gap-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="screen-kicker sigil">GOODBOT</p>
        <h1 className="screen-title text-4xl underline decoration-accent decoration-4 underline-offset-4 md:text-5xl">
          SERVIDORES
        </h1>
        <p className="max-w-prose text-sm opacity-70">
          {guilds.length > 0
            ? 'Escolha onde quer trabalhar. Sua permissão é resolvida por servidor.'
            : 'Nenhum servidor por aqui ainda.'}
        </p>
      </div>

      {guilds.length > 0 ? (
        <nav aria-label="Escolher servidor" className="flex w-full max-w-lg flex-col gap-2">
          {guilds.map((guild) => (
            <Link
              key={guild.id}
              href={`/g/${guild.id}`}
              prefetch={false}
              className="flex items-center gap-3 border-2 border-base-300 bg-base-100 px-3 py-3 text-left transition-colors hover:bg-base-200"
            >
              <AvatarSq src={guild.iconUrl} name={guild.name} size={40} />
              <span className="min-w-0 flex-1">
                <span className="screen-title block truncate text-base">{guild.name}</span>
                <span className="block truncate text-[10px] opacity-60">{guild.id}</span>
              </span>
              {guild.level !== 'none' ? <Tag tone="muted">{NIVEL[guild.level]}</Tag> : null}
            </Link>
          ))}
        </nav>
      ) : (
        <p className="max-w-prose text-center text-sm opacity-70">
          Você não administra nenhum servidor que o Goodbot atenda. Se acabou de convidar o bot, ele
          pode estar esperando aprovação.
        </p>
      )}

      <a className="btn-goodchat-outline" href={siteUrl('invite')}>
        ADICIONAR A OUTRO SERVIDOR
      </a>
    </main>
  );
}
