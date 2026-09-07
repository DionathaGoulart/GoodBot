import { hasAccess, type AccessLevel } from '@/lib/auth/access';

/**
 * §6.9 — a navegação inteira do painel. Com ~20 telas os seis itens que antes
 * moravam em `SERVIDOR` viraram três grupos: o que é **gestão** do servidor
 * (membros, cargos, canais…) fica em `SERVIDOR`, tudo que é `/config/*` vai
 * para `CONFIGURAÇÃO` e a auditoria/saúde para `SISTEMA`.
 */
export interface NavItem {
  label: string;
  /** Caminho relativo a `/g/[guildId]`; `''` é o dashboard. */
  href: string;
  /** Nível mínimo para o item aparecer. Sem isto, `mod` (PRD §9.2). */
  minimum?: AccessLevel;
  /** Sinônimos que a busca `Ctrl+K` também aceita. */
  keywords?: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'PAINEL',
    items: [{ label: 'Dashboard', href: '', keywords: ['início', 'estatísticas', 'home'] }],
  },
  {
    label: 'MODERAÇÃO',
    items: [{ label: 'Casos', href: '/casos', keywords: ['punições', 'histórico', 'ban', 'warn'] }],
  },
  {
    label: 'COMUNIDADE',
    items: [
      { label: 'Mensagens', href: '/mensagens', keywords: ['anúncio', 'embed', 'enviar'] },
    ],
  },
  {
    label: 'SERVIDOR',
    items: [
      { label: 'Membros', href: '/membros', keywords: ['usuários', 'pessoas'] },
      { label: 'Cargos', href: '/cargos', keywords: ['roles', 'permissões'] },
      { label: 'Canais', href: '/canais', keywords: ['channels', 'categorias'] },
      { label: 'Banidos', href: '/banidos', keywords: ['bans', 'desbanir'] },
      { label: 'Convites', href: '/convites', keywords: ['invites', 'links'] },
      { label: 'Eventos', href: '/eventos', keywords: ['agenda', 'scheduled'] },
      { label: 'Emojis', href: '/emojis', keywords: ['figurinhas', 'stickers', 'expressões'] },
    ],
  },
  {
    label: 'CONFIGURAÇÃO',
    items: [
      { label: 'Geral', href: '/config/general', keywords: ['prefixo', 'idioma', 'fuso'] },
      { label: 'Servidor', href: '/servidor', minimum: 'admin', keywords: ['nome', 'ícone'] },
      { label: 'Moderação', href: '/config/moderation', keywords: ['punições', 'escalonamento'] },
      { label: 'Automod', href: '/config/automod', keywords: ['filtro', 'spam', 'regras'] },
      { label: 'Logs', href: '/config/logs', keywords: ['mod-log', 'eventos'] },
      { label: 'Boas-vindas', href: '/config/welcome', keywords: ['welcome', 'entrada'] },
      { label: 'Autorole', href: '/config/autorole', keywords: ['cargo automático'] },
      { label: 'Tags', href: '/config/tags', keywords: ['respostas', 'atalhos'] },
      { label: 'Reaction roles', href: '/config/reaction-roles', keywords: ['reação', 'cargo'] },
      { label: 'Tickets', href: '/config/tickets', keywords: ['suporte', 'atendimento'] },
      { label: 'Redes sociais', href: '/config/social', keywords: ['twitch', 'youtube', 'feed'] },
      { label: 'Comandos', href: '/config/commands', keywords: ['slash', 'permissões'] },
    ],
  },
  {
    label: 'SISTEMA',
    items: [
      { label: 'Auditoria', href: '/auditoria', keywords: ['audit', 'quem mudou'] },
      { label: 'Saúde', href: '/system', minimum: 'owner', keywords: ['health', 'status', 'fila'] },
    ],
  },
];

/** Grupos visíveis para um nível — a autorização de verdade é do servidor. */
export function navGroupsFor(level: AccessLevel): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => hasAccess(level, item.minimum ?? 'mod')),
  })).filter((group) => group.items.length > 0);
}

/**
 * O item que responde por uma rota. `/config/logs` casa com o item de logs e
 * não com o dashboard, então o casamento mais **longo** vence.
 */
export function navItemForPath(guildId: string, pathname: string): NavItem | null {
  const base = `/g/${guildId}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  let best: NavItem | null = null;
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const matches =
        item.href === '' ? rest === '' || rest === '/' : rest === item.href || rest.startsWith(`${item.href}/`);
      if (matches && (!best || item.href.length > best.href.length)) best = item;
    }
  }
  return best;
}

/** Rótulo da rota atual, para o breadcrumb da topbar. */
export function labelForPath(guildId: string, pathname: string): string | null {
  return navItemForPath(guildId, pathname)?.label ?? null;
}

/** O grupo a que uma rota pertence — a sidebar abre esse grupo sozinha. */
export function groupLabelForPath(guildId: string, pathname: string): string | null {
  const item = navItemForPath(guildId, pathname);
  if (!item) return null;
  return NAV_GROUPS.find((group) => group.items.includes(item))?.label ?? null;
}
