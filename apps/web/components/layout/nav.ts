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
      { label: 'Automod', href: '/automod' },
      { label: 'Logs', href: '/logs' },
    ],
  },
  {
    label: 'COMUNIDADE',
    items: [
      { label: 'Boas-vindas', href: '/boas-vindas' },
      { label: 'Autorole', href: '/autorole' },
      { label: 'Tags', href: '/tags' },
      { label: 'Reaction roles', href: '/reaction-roles' },
      { label: 'Tickets', href: '/tickets' },
    ],
  },
  {
    label: 'SERVIDOR',
    items: [
      { label: 'Membros', href: '/membros' },
      { label: 'Cargos', href: '/cargos' },
      { label: 'Canais', href: '/canais' },
      { label: 'Configuração', href: '/config' },
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
