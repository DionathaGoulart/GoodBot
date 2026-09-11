import Link from 'next/link';

import { AvatarSq } from '@/components/retro/avatar-sq';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { signOutAction } from '@/app/actions/auth';

import { RefreshIndicator } from './refresh';
import { BotStatusIndicator, type BotStatus } from './bot-status';
import { Breadcrumbs } from './breadcrumbs';
import { CommandPalette } from './command-palette';
import { UserMenu } from './user-menu';

import type { AccessLevel } from '@/lib/auth/access';

/** §6.9 — breadcrumb à esquerda; frescor, tema, status do bot e conta à direita. */
export function Topbar({
  guildId,
  guildName,
  guildIconUrl,
  canSwitch,
  status,
  user,
  level,
}: {
  guildId: string;
  guildName: string;
  guildIconUrl?: string | null;
  /** Só há o que trocar com mais de um servidor acessível. */
  canSwitch?: boolean;
  status: BotStatus;
  user: { name: string; image: string | null };
  level: AccessLevel;
}) {
  return (
    // `min-w-0` no trilho do breadcrumb e `shrink-0` nos controles: no celular
    // é o caminho que encolhe, não a fila de botões da direita.
    <header className="flex items-center gap-2 border-b-2 border-base-300 bg-base-100 px-4 py-3 sm:gap-3">
      <SidebarTrigger className="icon-btn shrink-0 lg:hidden" />
      <div className="min-w-0 flex-1 overflow-hidden">
        <Breadcrumbs guildId={guildId} guildName={guildName} />
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {canSwitch ? (
          <Link
            href="/servidores"
            prefetch={false}
            title={`${guildName} — trocar de servidor`}
            aria-label="Trocar de servidor"
            className="shrink-0 border-2 border-base-300 p-0.5 hover:bg-base-200"
          >
            <AvatarSq src={guildIconUrl} name={guildName} size={24} />
          </Link>
        ) : null}
        <CommandPalette guildId={guildId} level={level} />
        <RefreshIndicator />
        <BotStatusIndicator status={status} />
        <ThemeToggle />
        <UserMenu name={user.name} image={user.image} level={level} onSignOut={signOutAction} />
      </div>
    </header>
  );
}
