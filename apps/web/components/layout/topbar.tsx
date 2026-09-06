import { ThemeToggle } from '@/components/theme/theme-toggle';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { signOutAction } from '@/app/actions/auth';

import { BotStatusIndicator, type BotStatus } from './bot-status';
import { Breadcrumbs } from './breadcrumbs';
import { UserMenu } from './user-menu';

/** §6.9 — breadcrumb à esquerda; tema, status do bot e conta à direita. */
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
  level: string;
}) {
  return (
    <header className="flex items-center gap-3 border-b-2 border-base-300 bg-base-100 px-4 py-3">
      <SidebarTrigger className="icon-btn lg:hidden" />
      <Breadcrumbs guildId={guildId} guildName={guildName} />
      <div className="ml-auto flex items-center gap-3">
        <BotStatusIndicator status={status} />
        <ThemeToggle />
        <UserMenu name={user.name} image={user.image} level={level} onSignOut={signOutAction} />
      </div>
    </header>
  );
}
