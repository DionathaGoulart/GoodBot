'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

import { navGroupsFor } from './nav';

import type { AccessLevel } from '@/lib/auth/access';

/** §6.9 — sidebar de 16rem; abaixo de `lg` o próprio shadcn a vira `sheet`. */
export function AppSidebar({
  guildId,
  guildName,
  level,
}: {
  guildId: string;
  guildName: string;
  level: AccessLevel;
}) {
  const pathname = usePathname();
  const base = `/g/${guildId}`;
  // Esconder o item não é a barreira: quem digitar a URL bate no
  // `requireGuildAccess` da própria página (PRD §7.3).
  const groups = navGroupsFor(level);

  return (
    <Sidebar>
      <SidebarHeader className="gap-1 border-b-2 border-base-300 px-4 py-4">
        <p className="screen-kicker sigil">COBOT</p>
        <p className="screen-title text-lg">{guildName}</p>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="sigil">{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const href = `${base}${item.href}`;
                  const isActive = item.href === '' ? pathname === base : pathname.startsWith(href);
                  return (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton asChild isActive={isActive}>
                        <Link href={href}>{item.label}</Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
