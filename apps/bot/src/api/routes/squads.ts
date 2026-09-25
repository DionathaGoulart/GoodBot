import { PublishSquadGuidesInputSchema } from '@goodbot/shared';
import { Hono } from 'hono';

import { requireActor } from '../actor';
import { validate } from '../validate';

import type { ApiDeps, ApiEnv } from '../context';
import type { PublishSquadGuidesResult } from '@goodbot/shared';

/**
 * O módulo de squads não tem estado para o painel ler (PRD §5.11): a única
 * rota é o botão que publica os guias e os botões, o mesmo `publish` do
 * `/squad painel`. Faltas (módulo desligado, sem canal, sem permissão) voltam
 * como `UserFacingError`, e o toast mostra o motivo.
 */
export function createSquadRoutes(deps: ApiDeps) {
  return new Hono<ApiEnv>().post(
    '/guides',
    validate('json', PublishSquadGuidesInputSchema),
    async (c) => {
      const { actorId } = c.req.valid('json');
      const guild = c.get('guild');
      await requireActor(deps, guild, actorId, 'admin');

      const result: PublishSquadGuidesResult = await deps.squadGuides.publish(
        guild,
        actorId,
        'dashboard',
      );
      return c.json(result);
    },
  );
}
