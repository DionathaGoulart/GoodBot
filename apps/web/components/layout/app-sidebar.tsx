'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useSyncExternalStore } from 'react';

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';

import { groupLabelForPath, navGroupsFor } from './nav';

import type { AccessLevel } from '@/lib/auth/access';

/** Grupos fechados, por rótulo. Só isto vai para o `localStorage`. */
const STORAGE_KEY = 'goodbot-nav-collapsed';

// Mesmo padrão do `ThemeProvider`: o `localStorage` é um store externo, lido
// por `useSyncExternalStore`. Assim o servidor renderiza tudo aberto e o
// cliente aplica a preferência sem `useState` + efeito (que renderiza duas
// vezes e é o que o `react-hooks/set-state-in-effect` proíbe).
const NONE: string[] = [];
const listeners = new Set<() => void>();

let snapshot: string[] | null = null;

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** O snapshot precisa ser estável: só troca quando alguém escreve. */
function readCollapsed(): string[] {
  if (snapshot) return snapshot;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    snapshot = Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : NONE;
  } catch {
    // Modo privado, storage cheio, JSON velho — nada disso quebra a nav.
    snapshot = NONE;
  }
  return snapshot;
}

function writeCollapsed(next: string[]) {
  snapshot = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A preferência é um conforto; perder o registro não custa nada.
  }
  for (const listener of listeners) listener();
}

/**
 * §6.9 — sidebar de 16rem; abaixo de `lg` o próprio shadcn a vira `sheet`.
 * Com seis grupos e 24 telas os grupos colapsam, e o que está fechado fica no
 * `localStorage` para a barra abrir do mesmo jeito na próxima visita.
 */
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
  const activeGroup = groupLabelForPath(guildId, pathname);

  // No servidor tudo aberto; a preferência entra na primeira renderização do
  // cliente, depois da hidratação.
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => NONE);

  // No celular a navegação acontece dentro da gaveta: sem fechá-la a tela nova
  // carrega atrás dela e a pessoa fica olhando o menu.
  const { isMobile, setOpenMobile } = useSidebar();
  const closeOnMobile = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  const toggle = useCallback((label: string) => {
    const current = readCollapsed();
    writeCollapsed(
      current.includes(label) ? current.filter((item) => item !== label) : [...current, label],
    );
  }, []);

  return (
    <Sidebar>
      <SidebarHeader className="gap-1 border-b-2 border-base-300 px-4 py-4">
        <p className="screen-kicker sigil">GOODBOT</p>
        <p className="screen-title text-lg">{guildName}</p>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => {
          // O grupo da tela aberta nunca some — senão o item ativo fica órfão.
          const open = group.label === activeGroup || !collapsed.includes(group.label);
          const contentId = `nav-${group.label.toLowerCase()}`;
          return (
            <SidebarGroup key={group.label}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={contentId}
                onClick={() => toggle(group.label)}
                className="section-label flex h-8 w-full shrink-0 items-center justify-between px-3 transition-colors hover:text-base-content"
              >
                <span className="sigil">{group.label}</span>
                <span aria-hidden>{open ? '▾' : '▸'}</span>
              </button>
              <SidebarGroupContent id={contentId} hidden={!open}>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const href = `${base}${item.href}`;
                    const isActive =
                      item.href === ''
                        ? pathname === base
                        : pathname === href || pathname.startsWith(`${href}/`);
                    return (
                      <SidebarMenuItem key={item.label}>
                        <SidebarMenuButton asChild isActive={isActive}>
                          <Link href={href} onClick={closeOnMobile}>
                            {item.label}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
    </Sidebar>
  );
}
