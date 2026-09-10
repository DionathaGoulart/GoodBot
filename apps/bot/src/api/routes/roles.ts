import {
  ActorInputSchema,
  RoleMoveInputSchema,
  RoleWriteInputSchema,
  mergePermissions,
  permissionsToBitfield,
} from '@goodbot/shared';
import { Hono } from 'hono';

import { assertRoleManageable, requireActor, requireBotMember } from '../actor';
import { forbidden, notFound } from '../errors';
import { toRoleSummary } from '../mappers';
import { validate } from '../validate';

import type { ApiDeps, ApiEnv } from '../context';
import type { Guild, GuildMember, Role } from 'discord.js';

function requireRole(guild: Guild, roleId: string): Role {
  const role = guild.roles.cache.get(roleId);
  if (!role) throw notFound('Cargo não encontrado.', 'ROLE_NOT_FOUND');
  return role;
}

/**
 * Ninguém dá pelo painel uma permissão que não tem: sem isso, um admin sem
 * `BanMembers` criaria um cargo com `BanMembers` e se daria o cargo. O owner
 * passa, porque ele já tem tudo por definição.
 */
function assertMayGrant(actor: GuildMember, permissions: string): void {
  if (actor.id === actor.guild.ownerId) return;
  const requested = BigInt(permissions);
  const missing = requested & ~actor.permissions.bitfield;
  if (missing !== 0n) {
    throw forbidden(
      'Você não pode conceder uma permissão que você mesmo não tem.',
      'GRANT_ABOVE_ACTOR',
    );
  }
}

/**
 * Gestão de cargos pelo painel (PRD §6.3). Só `admin`, e sempre sob a
 * hierarquia: acima do cargo do ator ou do cargo do bot, nada passa.
 */
export function createRoleRoutes(deps: ApiDeps): Hono<ApiEnv> {
  return (
    new Hono<ApiEnv>()
      .post('/', validate('json', RoleWriteInputSchema), async (c) => {
        const input = c.req.valid('json');
        const guild = c.get('guild');
        const actor = await requireActor(deps, guild, input.actorId, 'admin');

        const permissions = permissionsToBitfield(input.permissions);
        assertMayGrant(actor, permissions);

        const role = await guild.roles.create({
          name: input.name,
          color: input.color,
          hoist: input.hoist,
          mentionable: input.mentionable,
          permissions: BigInt(permissions),
          reason: input.reason ?? `Criado pelo painel por ${actor.user.tag}`,
        });
        return c.json(toRoleSummary(role));
      })

      .patch('/:roleId', validate('json', RoleWriteInputSchema), async (c) => {
        const input = c.req.valid('json');
        const guild = c.get('guild');
        const actor = await requireActor(deps, guild, input.actorId, 'admin');
        const role = requireRole(guild, c.req.param('roleId'));
        assertRoleManageable(guild, actor, role);

        // `mergePermissions` guarda os bits que a checklist do painel não mostra,
        // então salvar um cargo aqui nunca apaga uma permissão nova do Discord.
        const permissions = mergePermissions(
          role.permissions.bitfield.toString(),
          input.permissions,
        );
        assertMayGrant(actor, permissions);

        const updated = await role.edit({
          name: input.name,
          color: input.color,
          hoist: input.hoist,
          mentionable: input.mentionable,
          permissions: BigInt(permissions),
          reason: input.reason ?? `Editado pelo painel por ${actor.user.tag}`,
        });
        return c.json(toRoleSummary(updated));
      })

      .delete('/:roleId', validate('json', ActorInputSchema), async (c) => {
        const input = c.req.valid('json');
        const guild = c.get('guild');
        const actor = await requireActor(deps, guild, input.actorId, 'admin');
        const role = requireRole(guild, c.req.param('roleId'));
        assertRoleManageable(guild, actor, role);

        await role.delete(input.reason ?? `Apagado pelo painel por ${actor.user.tag}`);
        return c.json({ ok: true as const });
      })

      /**
       * `▲`/`▼`: uma casa por clique. O destino também passa pela hierarquia —
       * subir por cima de um cargo intocável é o mesmo que editá-lo.
       */
      .patch('/:roleId/position', validate('json', RoleMoveInputSchema), async (c) => {
        const input = c.req.valid('json');
        const guild = c.get('guild');
        const actor = await requireActor(deps, guild, input.actorId, 'admin');
        const role = requireRole(guild, c.req.param('roleId'));
        assertRoleManageable(guild, actor, role);

        const target = input.direction === 'up' ? role.position + 1 : role.position - 1;
        if (target <= 0) {
          throw forbidden('Esse cargo já está no fim da lista.', 'ROLE_AT_BOTTOM');
        }
        const above = guild.roles.cache.find((other) => other.position === target);
        if (above) assertRoleManageable(guild, actor, above);
        if (target >= requireBotMember(guild).roles.highest.position) {
          throw forbidden(
            'Não dá para mover um cargo para cima do cargo do bot.',
            'BOT_ROLE_HIERARCHY',
          );
        }

        const moved = await role.setPosition(input.direction === 'up' ? 1 : -1, {
          relative: true,
          reason: input.reason ?? `Reordenado pelo painel por ${actor.user.tag}`,
        });
        return c.json(toRoleSummary(moved));
      })
  );
}
