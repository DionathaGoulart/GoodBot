import { PermissionFlagsBits } from 'discord.js';

import type { ResolvedSettings } from './config';
import type { PermissionLevel } from '@cobot/shared';
import type { GuildMember, PermissionsBitField } from 'discord.js';

/**
 * Visão mínima de um membro para as regras de permissão. Mantém a lógica pura
 * (testável sem instanciar `GuildMember`) e independente do discord.js.
 */
export interface MemberLike {
  id: string;
  isOwner: boolean;
  isBot: boolean;
  roleIds: readonly string[];
  /** Posição do cargo mais alto; maior = mais alto. */
  highestRolePosition: number;
  hasPermission(flag: bigint): boolean;
}

export function toMemberLike(member: GuildMember): MemberLike {
  const permissions: PermissionsBitField = member.permissions;
  return {
    id: member.id,
    isOwner: member.id === member.guild.ownerId,
    isBot: member.user.bot,
    roleIds: member.roles.cache.map((role) => role.id),
    highestRolePosition: member.roles.highest.position,
    hasPermission: (flag) => permissions.has(flag),
  };
}

const MOD_PERMISSIONS = [
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
] as const;

/** Ordem dos níveis: `member` < `mod` < `admin` (PRD §9.1). */
const LEVEL_RANK: Record<PermissionLevel, number> = { member: 0, mod: 1, admin: 2 };

export function levelAtLeast(actual: PermissionLevel, required: PermissionLevel): boolean {
  return LEVEL_RANK[actual] >= LEVEL_RANK[required];
}

/**
 * Nível efetivo de um membro: cargos configurados em `guild_settings` somados
 * às permissões nativas do Discord. Owner é sempre `admin`.
 */
export function resolveLevel(
  member: MemberLike,
  settings: Pick<ResolvedSettings, 'adminRoleIds' | 'modRoleIds'>,
): PermissionLevel {
  if (member.isOwner) return 'admin';

  const hasRole = (ids: readonly string[]) => ids.some((id) => member.roleIds.includes(id));

  if (member.hasPermission(PermissionFlagsBits.Administrator)) return 'admin';
  if (hasRole(settings.adminRoleIds)) return 'admin';
  if (hasRole(settings.modRoleIds)) return 'mod';
  if (MOD_PERMISSIONS.some((flag) => member.hasPermission(flag))) return 'mod';
  return 'member';
}

export type CanActResult = { ok: true } | { ok: false; code: string; reason: string };

const DENY = (code: string, reason: string): CanActResult => ({ ok: false, code, reason });

/**
 * Hierarquia para ações de moderação: ninguém age sobre si mesmo, sobre o
 * owner ou sobre alguém com cargo igual/superior. O owner passa por cima da
 * hierarquia entre membros, mas nunca por cima da do próprio bot — essa é
 * imposta pelo Discord.
 */
export function canActOn(
  actor: MemberLike,
  target: MemberLike,
  options: { bot?: MemberLike } = {},
): CanActResult {
  if (actor.id === target.id) {
    return DENY('SELF_TARGET', 'Você não pode usar esta ação em si mesmo.');
  }
  if (target.isOwner) {
    return DENY('TARGET_OWNER', 'Não é possível moderar o dono do servidor.');
  }

  const { bot } = options;
  if (bot) {
    if (target.id === bot.id) {
      return DENY('TARGET_BOT', 'Não é possível moderar o próprio bot.');
    }
    if (bot.highestRolePosition <= target.highestRolePosition) {
      return DENY(
        'BOT_HIERARCHY',
        'O cargo do bot está abaixo do cargo do alvo. Mova o cargo do bot para cima.',
      );
    }
  }

  if (actor.isOwner) return { ok: true };

  if (actor.highestRolePosition <= target.highestRolePosition) {
    return DENY('HIERARCHY', 'Você não pode moderar alguém com cargo igual ou superior ao seu.');
  }

  return { ok: true };
}

/** O mínimo que a hierarquia precisa saber sobre um cargo. */
export interface RoleLike {
  id: string;
  position: number;
  /** Cargo de integração (bot, boost): o Discord não deixa ninguém editar. */
  managed: boolean;
  /** `@everyone`, que tem a posição 0 e não pode ser mexido. */
  isEveryone: boolean;
}

/**
 * Hierarquia para mexer num cargo pelo painel (PRD §6.3). Vale para editar,
 * deletar, mover e para dar/tirar o cargo de um membro. Diferente de
 * `canActOn`, o owner **não** passa por cima do cargo do bot: quem executa a
 * chamada na API do Discord é o bot, e o Discord recusa.
 */
export function canManageRole(actor: MemberLike, role: RoleLike, bot: MemberLike): CanActResult {
  if (role.isEveryone) {
    return DENY('ROLE_EVERYONE', 'O cargo @everyone não pode ser gerenciado por aqui.');
  }
  if (role.managed) {
    return DENY('ROLE_MANAGED', 'Esse cargo é gerenciado por uma integração do Discord.');
  }
  if (bot.highestRolePosition <= role.position) {
    return DENY(
      'BOT_ROLE_HIERARCHY',
      'Esse cargo está acima do cargo do bot. Mova o cargo do bot para cima.',
    );
  }
  if (actor.isOwner) return { ok: true };
  if (actor.highestRolePosition <= role.position) {
    return DENY('ROLE_HIERARCHY', 'Você não pode mexer num cargo igual ou acima do seu.');
  }
  return { ok: true };
}
