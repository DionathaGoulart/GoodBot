import { AppSidebar } from '@/components/layout/app-sidebar';
import { AutoRefreshProvider } from '@/components/layout/auto-refresh';
import { BotStatusBanner, readBotStatus } from '@/components/layout/bot-status';
import { Topbar } from '@/components/layout/topbar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { requireGuildAccess } from '@/lib/auth/require';

export default async function GuildLayout({ children, params }: LayoutProps<'/g/[guildId]'>) {
  const { guildId } = await params;
  // A checagem se repete em cada page/action (PRD §7.3); aqui ela só evita
  // renderizar o casco para quem não deveria vê-lo.
  const session = await requireGuildAccess(guildId);
  const status = await readBotStatus();

  // O nome ao vivo do servidor chega na Etapa 16; até lá o id serve de rótulo.
  const guildName = 'SERVIDOR';

  return (
    <AutoRefreshProvider>
      <SidebarProvider>
        <AppSidebar guildId={guildId} guildName={guildName} level={session.level} />
        <SidebarInset className="min-w-0">
          <Topbar
            guildId={guildId}
            guildName={guildName}
            status={status}
            user={{ name: session.user.name, image: session.user.image }}
            level={session.level}
          />
          <BotStatusBanner status={status} />
          <div className="screen-pad flex flex-1 flex-col gap-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </AutoRefreshProvider>
  );
}
