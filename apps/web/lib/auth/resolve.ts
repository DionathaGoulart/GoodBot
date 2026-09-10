import 'server-only';

import { guildSettings, guilds } from '@goodbot/db';
import { InternalApiError } from '@goodbot/shared';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import { env } from '../env';
import { internalApi } from '../internal-api';
import { resolveAccessLevel, type AccessLevel } from './access';

export { ACCESS_CHECK_TTL_MS, isStale, retryAt } from './access';

/**
 * Pergunta ao bot (cache de membros e cargos ao vivo) e ao banco (cargos
 * configurados) qual o nível do usuário. Bot fora do ar → `none`: sem
 * confirmação de permissão o painel não libera nada.
 */
export async function resolveGuildLevel(userId: string): Promise<AccessLevel> {
  const guildId = env().GUILD_ID;

  let memberRoleIds: string[] | null = null;
  let rolePermissions: Record<string, string> = {};
  try {
    const api = internalApi();
    const [member, roles] = await Promise.all([api.member(guildId, userId), api.roles(guildId)]);
    memberRoleIds = [...member.roleIds, guildId]; // `@everyone` tem o id da guild.
    rolePermissions = Object.fromEntries(roles.map((role) => [role.id, role.permissions]));
  } catch (error) {
    // Não estar no servidor é uma resposta legítima, não uma falha.
    if (error instanceof InternalApiError && error.status === 404) return 'none';
    throw error;
  }

  const [guild] = await db().select().from(guilds).where(eq(guilds.id, guildId)).limit(1);
  const [settings] = await db()
    .select()
    .from(guildSettings)
    .where(eq(guildSettings.guildId, guildId))
    .limit(1);

  return resolveAccessLevel({
    userId,
    ownerId: guild?.ownerId ?? null,
    memberRoleIds,
    rolePermissions,
    adminRoleIds: settings?.adminRoleIds,
    modRoleIds: settings?.modRoleIds,
    dashboardAccessRoleIds: settings?.dashboardAccessRoleIds,
  });
}
