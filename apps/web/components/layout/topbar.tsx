import { ThemeToggle } from '@/components/theme/theme-toggle';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { signOutAction } from '@/app/actions/auth';

import { AutoRefreshIndicator } from './auto-refresh';
import { BotStatusIndicator, type BotStatus } from './bot-status';
import { Breadcrumbs } from './breadcrumbs';
import { CommandPalette } from './command-palette';
import { UserMenu } from './user-menu';

import type { AccessLevel } from '@/lib/auth/access';

/** §6.9 — breadcrumb à esquerda; frescor, tema, status do bot e conta à direita. */
export function Topbar({
  guildId,
  guildName,
  status,
  user,
  level,
}: {
  guildId: string;
  guildName: string;
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
        <CommandPalette guildId={guildId} level={level} />
        <AutoRefreshIndicator />
        <BotStatusIndicator status={status} />
        <ThemeToggle />
        <UserMenu name={user.name} image={user.image} level={level} onSignOut={signOutAction} />
      </div>
    </header>
  );
}
