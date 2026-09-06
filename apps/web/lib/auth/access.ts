/**
 * Níveis de acesso ao painel (PRD §9.2). Puro de propósito: dá para testar
 * sem banco, sem sessão e sem rede.
 */
export const ACCESS_LEVELS = ['none', 'mod', 'admin', 'owner'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

/** Permissões nativas do Discord que já valem `admin` no painel. */
const ADMINISTRATOR = 1n << 3n;
const MANAGE_GUILD = 1n << 5n;

export function rankOf(level: AccessLevel): number {
  return ACCESS_LEVELS.indexOf(level);
}

/** `true` quando `level` alcança pelo menos `minimum`. */
export function hasAccess(level: AccessLevel, minimum: AccessLevel): boolean {
  return rankOf(level) >= rankOf(minimum);
}

export interface AccessInput {
  userId: string;
  /** Owner do servidor; `null` quando a guild ainda não foi sincronizada. */
  ownerId: string | null;
  /** `null` = o usuário não está no servidor. */
  memberRoleIds: string[] | null;
  /** Bitfield de permissões por cargo, como texto (BigInt serializado). */
  rolePermissions: Record<string, string>;
  adminRoleIds?: string[] | null;
  modRoleIds?: string[] | null;
  dashboardAccessRoleIds?: string[] | null;
}

function toBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function intersects(a: string[], b: string[] | null | undefined): boolean {
  return !!b && a.some((id) => b.includes(id));
}

/**
 * Resolve o nível a partir do que o bot e o banco sabem. Ordem: owner →
 * `Administrator`/`ManageGuild` ou cargo de admin → cargo de mod ou de acesso
 * ao painel → nada.
 */
export function resolveAccessLevel(input: AccessInput): AccessLevel {
  const { memberRoleIds } = input;
  if (!memberRoleIds) return 'none';
  if (input.ownerId && input.userId === input.ownerId) return 'owner';

  const permissions = memberRoleIds.reduce(
    (acc, roleId) => acc | toBigInt(input.rolePermissions[roleId] ?? '0'),
    0n,
  );
  const isDiscordAdmin =
    (permissions & ADMINISTRATOR) === ADMINISTRATOR ||
    (permissions & MANAGE_GUILD) === MANAGE_GUILD;

  if (isDiscordAdmin || intersects(memberRoleIds, input.adminRoleIds)) return 'admin';
  if (
    intersects(memberRoleIds, input.modRoleIds) ||
    intersects(memberRoleIds, input.dashboardAccessRoleIds)
  ) {
    return 'mod';
  }
  return 'none';
}

export interface SessionLike {
  user?: { id?: string | null };
  level?: AccessLevel;
  guildId?: string;
}

/**
 * Decisão de acesso isolada do Next: `requireGuildAccess` só traduz o
 * veredito em `redirect`. Assim os níveis dão para testar sem sessão.
 */
export function checkGuildAccess(
  session: SessionLike | null,
  guildId: string,
  minimum: AccessLevel,
): 'ok' | 'unauthenticated' | 'denied' {
  if (!session?.user?.id) return 'unauthenticated';
  if (session.guildId !== guildId) return 'denied';
  return hasAccess(session.level ?? 'none', minimum) ? 'ok' : 'denied';
}
