/**
 * §6.9 — a navegação inteira do painel. As páginas nascem nas etapas 13–17;
 * os itens já ficam aqui para a sidebar não mudar de forma a cada etapa.
 */
export interface NavItem {
  label: string;
  /** Caminho relativo a `/g/[guildId]`; `''` é o dashboard. */
  href: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'PAINEL',
    items: [{ label: 'Dashboard', href: '' }],
  },
  {
    label: 'MODERAÇÃO',
    items: [
      { label: 'Casos', href: '/casos' },
      { label: 'Moderação', href: '/config/moderation' },
      { label: 'Automod', href: '/config/automod' },
      { label: 'Logs', href: '/config/logs' },
    ],
  },
  {
    label: 'COMUNIDADE',
    items: [
      { label: 'Boas-vindas', href: '/config/welcome' },
      { label: 'Autorole', href: '/config/autorole' },
      { label: 'Tags', href: '/config/tags' },
      { label: 'Reaction roles', href: '/config/reaction-roles' },
      { label: 'Tickets', href: '/config/tickets' },
    ],
  },
  {
    label: 'SERVIDOR',
    items: [
      { label: 'Membros', href: '/membros' },
      { label: 'Cargos', href: '/cargos' },
      { label: 'Canais', href: '/canais' },
      { label: 'Geral', href: '/config/general' },
      { label: 'Auditoria', href: '/auditoria' },
    ],
  },
];

/** Rótulo da rota atual, para o breadcrumb da topbar. */
export function labelForPath(guildId: string, pathname: string): string | null {
  const base = `/g/${guildId}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (item.href === '' ? rest === '' || rest === '/' : rest.startsWith(item.href)) {
        return item.label;
      }
    }
  }
  return null;
}
