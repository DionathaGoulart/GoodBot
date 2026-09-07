import { forbidden, notFound } from './errors';
import { fetchMember } from '../services/moderation';
import { canManageRole, levelAtLeast, resolveLevel, toMemberLike } from '../services/permissions';

import type { ApiDeps } from './context';
import type { RoleLike } from '../services/permissions';
import type { PermissionLevel } from '@cobot/shared';
import type { Guild, GuildMember, Role } from 'discord.js';

/**
 * Quem clicou no painel. O Bearer só prova que a chamada veio do painel, não
 * de quem — é o `actorId` do corpo que responde por isso, e ele precisa ser um
 * membro real com o nível pedido neste servidor (PRD §9.2).
 */
export async function requireActor(
  deps: ApiDeps,
  guild: Guild,
  actorId: string,
  minimum: PermissionLevel,
): Promise<GuildMember> {
  const actor = await fetchMember(guild, actorId);
  if (!actor) throw forbidden('O autor da ação não está no servidor.', 'ACTOR_NOT_MEMBER');

  const settings = await deps.config.getSettings(guild.id);
  const level = resolveLevel(toMemberLike(actor), settings);
  if (!levelAtLeast(level, minimum)) {
    throw forbidden(
      minimum === 'admin'
        ? 'O autor da ação não é administrador.'
        : 'O autor da ação não é moderador.',
      minimum === 'admin' ? 'ACTOR_NOT_ADMIN' : 'ACTOR_NOT_MOD',
    );
  }
  return actor;
}

/** O `GuildMember` do próprio bot; sem ele nenhuma escrita faz sentido. */
export function requireBotMember(guild: Guild): GuildMember {
  const me = guild.members.me;
  if (!me) throw notFound('O bot não está no servidor.', 'BOT_NOT_MEMBER');
  return me;
}

function toRoleLike(guild: Guild, role: Role): RoleLike {
  return {
    id: role.id,
    position: role.position,
    managed: role.managed,
    isEveryone: role.id === guild.id,
  };
}

/** Hierarquia de cargo (§6.3): 403 com a mesma mensagem que o Discord daria. */
export function assertRoleManageable(guild: Guild, actor: GuildMember, role: Role): void {
  const result = canManageRole(
    toMemberLike(actor),
    toRoleLike(guild, role),
    toMemberLike(requireBotMember(guild)),
  );
  if (!result.ok) throw forbidden(result.reason, result.code);
}
