import { MemberRolesInputSchema, isSnowflake } from '@goodbot/shared';
import { Hono } from 'hono';

import { fetchMember } from '../../services/moderation';
import { canActOn, toMemberLike } from '../../services/permissions';
import { assertRoleManageable, requireActor, requireBotMember } from '../actor';
import { forbidden, notFound } from '../errors';
import { toMemberDetail } from '../mappers';
import { validate } from '../validate';

import type { ApiDeps, ApiEnv } from '../context';
import type { Guild, GuildMember, Role } from 'discord.js';

function requireRoles(guild: Guild, actor: GuildMember, roleIds: string[]): Role[] {
  return roleIds.map((roleId) => {
    const role = guild.roles.cache.get(roleId);
    if (!role) throw notFound('Cargo não encontrado.', 'ROLE_NOT_FOUND');
    assertRoleManageable(guild, actor, role);
    return role;
  });
}

/**
 * Cargos de um membro pelo painel (PRD §6.3). Só `admin`, e o ator precisa
 * estar acima tanto do membro quanto de cada cargo — dar um cargo acima do seu
 * é escalar privilégio por caminho torto.
 */
export function createMemberRoutes(deps: ApiDeps): Hono<ApiEnv> {
  return new Hono<ApiEnv>().post(
    '/:userId/roles',
    validate('json', MemberRolesInputSchema),
    async (c) => {
      const input = c.req.valid('json');
      const userId = c.req.param('userId');
      if (!isSnowflake(userId)) throw notFound('Usuário inválido.', 'INVALID_USER_ID');

      const guild = c.get('guild');
      const actor = await requireActor(deps, guild, input.actorId, 'admin');
      const target = await fetchMember(guild, userId);
      if (!target) throw notFound('Este usuário não está no servidor.', 'MEMBER_NOT_FOUND');

      const hierarchy = canActOn(toMemberLike(actor), toMemberLike(target), {
        bot: toMemberLike(requireBotMember(guild)),
      });
      if (!hierarchy.ok) throw forbidden(hierarchy.reason, hierarchy.code);

      const add = requireRoles(guild, actor, input.add);
      const remove = requireRoles(guild, actor, input.remove);
      const reason = input.reason ?? `Cargos pelo painel por ${actor.user.tag}`;

      let updated = target;
      if (add.length > 0) updated = await updated.roles.add(add, reason);
      if (remove.length > 0) updated = await updated.roles.remove(remove, reason);
      return c.json(toMemberDetail(updated));
    },
  );
}
