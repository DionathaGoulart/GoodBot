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

import { NAV_GROUPS } from './nav';

/** §6.9 — sidebar de 16rem; abaixo de `lg` o próprio shadcn a vira `sheet`. */
export function AppSidebar({ guildId, guildName }: { guildId: string; guildName: string }) {
  const pathname = usePathname();
  const base = `/g/${guildId}`;

  return (
    <Sidebar>
      <SidebarHeader className="gap-1 border-b-2 border-base-300 px-4 py-4">
        <p className="screen-kicker sigil">COBOT</p>
        <p className="screen-title text-lg">{guildName}</p>
      </SidebarHeader>
      <SidebarContent>
        {NAV_GROUPS.map((group) => (
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
