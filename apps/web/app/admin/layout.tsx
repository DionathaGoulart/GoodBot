import { ThemeToggle } from '@/components/theme/theme-toggle';
import { UserMenu } from '@/components/layout/user-menu';
import { signOutAction } from '@/app/actions/auth';
import { requireBotOwner } from '@/lib/auth/owner';

import { AdminNav } from './admin-nav';

export const metadata = { title: 'Admin · Goodbot' };

/**
 * O painel do dono do bot (`admin.<domínio>`, plano, Etapa 4).
 *
 * Casco próprio, sem a sidebar do painel comum: aquela é organizada por guild
 * (`/g/[guildId]/...`) e aqui não existe "a" guild — a tela toda é sobre o
 * conjunto. A checagem se repete em cada página e em cada action; aqui ela só
 * evita renderizar a moldura para quem não deveria vê-la.
 */
export default async function AdminLayout({ children }: LayoutProps<'/admin'>) {
  const session = await requireBotOwner();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b-2 border-base-300 bg-base-100 px-4 py-3">
        <p className="screen-kicker sigil shrink-0">GOODBOT · ADMIN</p>
        <div className="min-w-0 flex-1">
          <AdminNav />
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <ThemeToggle />
          <UserMenu
            name={session.user.name}
            image={session.user.image}
            level="dono do bot"
            onSignOut={signOutAction}
          />
        </div>
      </header>
      <div className="screen-pad flex flex-1 flex-col gap-6">{children}</div>
    </div>
  );
}
