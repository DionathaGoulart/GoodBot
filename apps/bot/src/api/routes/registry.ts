import { getGuildRegistryEntry } from '@goodbot/db';
import { InviteNoticeInputSchema } from '@goodbot/shared';
import { Hono } from 'hono';

import { sendInviterDm } from '../../lib/inviter-dm';
import { notFound } from '../errors';
import { validate } from '../validate';

import type { ApiDeps, ApiEnv } from '../context';
import type { InviteNoticeResult } from '@goodbot/shared';

export interface RegistryRoutesOptions {
  /** Os links que os avisos citam. Ausentes (dev sem `AUTH_URL`) = aviso sem link. */
  urls?: { invite?: string | null; panel?: string | null };
}

/**
 * O ciclo de vida do convite, do lado do bot.
 *
 * Fora de `/guilds` pela mesma razão do `/admin`: metade dos avisos é sobre
 * servidor que o bot **não** atende — a fila e as recusas —, e o `withGuild`
 * recusaria justamente esses.
 *
 * Não há `actorId`, e é deliberado (ver `shared/api/registry.ts`): não existe
 * ator. O destinatário não é escolhido pela chamada, é o `invited_by` da linha
 * do registro; o corpo só escolhe qual texto de uma lista fechada sai, e o
 * texto mora no bot. O Bearer continua provando que a chamada veio do painel.
 */
export function createRegistryRoutes(
  deps: ApiDeps,
  options: RegistryRoutesOptions = {},
): Hono<ApiEnv> {
  return new Hono<ApiEnv>().post(
    '/:guildId/notice',
    validate('json', InviteNoticeInputSchema),
    async (c) => {
      const guildId = c.req.param('guildId');
      const input = c.req.valid('json');

      const entry = await getGuildRegistryEntry(deps.db, guildId);
      if (!entry) throw notFound('Servidor não está no registro.', 'GUILD_NOT_REGISTERED');

      // O nome sai do cache quando o bot ainda está lá. Nas recusas ele já
      // saiu, e o aviso diz "seu servidor" em vez de mentir um nome.
      const guild = deps.client.guilds.cache.get(guildId);

      const delivered = await sendInviterDm(deps.client, entry.invitedBy, {
        kind: input.kind,
        guildName: guild?.name ?? null,
        expiresAt: entry.expiresAt,
        ...(input.reason ? { reason: input.reason } : {}),
        ...(options.urls ? { urls: options.urls } : {}),
      });

      const result: InviteNoticeResult = { delivered, userId: entry.invitedBy };
      return c.json(result);
    },
  );
}
