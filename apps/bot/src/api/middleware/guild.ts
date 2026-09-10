import { isSnowflake } from '@goodbot/shared';
import { createMiddleware } from 'hono/factory';

import { ApiHttpError, notFound } from '../errors';

import type { ApiDeps, ApiEnv } from '../context';

/**
 * Resolve `:guildId` uma vez por requisição e guarda a `Guild` no contexto.
 * Toda rota abaixo de `/guilds/:guildId` filtra por ela — nunca por
 * `env.GUILD_ID` (CLAUDE.md: single-server hoje, multi amanhã).
 */
export function withGuild(deps: ApiDeps) {
  return createMiddleware<ApiEnv>(async (c, next) => {
    const guildId = c.req.param('guildId');
    if (!guildId || !isSnowflake(guildId)) {
      throw new ApiHttpError(400, 'INVALID_GUILD_ID', 'guildId não é um snowflake válido.');
    }

    const guild = deps.client.guilds.cache.get(guildId);
    if (!guild) throw notFound('O bot não está neste servidor.', 'GUILD_NOT_FOUND');

    c.set('guild', guild);
    await next();
  });
}
