import { AppSidebar } from '@/components/layout/app-sidebar';
import { AutoRefreshProvider } from '@/components/layout/auto-refresh';
import { BotStatusBanner, readBotStatus } from '@/components/layout/bot-status';
import { Topbar } from '@/components/layout/topbar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { requireGuildAccess } from '@/lib/auth/require';
import { listAccessibleGuilds } from '@/lib/guilds';

export default async function GuildLayout({ children, params }: LayoutProps<'/g/[guildId]'>) {
  const { guildId } = await params;
  // A checagem se repete em cada page/action (PRD §7.3); aqui ela só evita
  // renderizar o casco para quem não deveria vê-lo.
  const session = await requireGuildAccess(guildId);
  const status = await readBotStatus();

  // Com mais de um servidor o nome deixa de ser enfeite: sem ele as duas
  // telas ficam idênticas e não dá para saber onde se está clicando. A lista é
  // só a que este usuário pode abrir.
  const guilds = await listAccessibleGuilds();
  const atual = guilds.find((g) => g.id === guildId);
  const guildName = atual?.name ?? 'SERVIDOR';

  return (
    <AutoRefreshProvider>
      <SidebarProvider>
        <AppSidebar guildId={guildId} guildName={guildName} guilds={guilds} level={session.level} />
        <SidebarInset className="min-w-0">
          <Topbar
            guildId={guildId}
            guildName={guildName}
            guildIconUrl={atual?.iconUrl ?? null}
            canSwitch={guilds.length > 1}
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
