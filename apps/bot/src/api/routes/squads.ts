import { PublishSquadPanelInputSchema } from '@goodbot/shared';
import { Hono } from 'hono';

import { requireActor } from '../actor';
import { validate } from '../validate';

import type { ApiDeps, ApiEnv } from '../context';
import type { PublishSquadPanelResult } from '@goodbot/shared';

/**
 * O módulo de squads não tem estado para o painel ler (PRD §5.11): a única
 * rota é o botão que publica o painel fixo, o mesmo `publish` do `/squad
 * painel`. Faltas (módulo desligado, sem canal, sem permissão) voltam como
 * `UserFacingError`, e o toast mostra o motivo.
 */
export function createSquadRoutes(deps: ApiDeps) {
  return new Hono<ApiEnv>().post(
    '/panel',
    validate('json', PublishSquadPanelInputSchema),
    async (c) => {
      const { actorId } = c.req.valid('json');
      const guild = c.get('guild');
      await requireActor(deps, guild, actorId, 'admin');

      const result: PublishSquadPanelResult = await deps.squadPanel.publish(
        guild,
        actorId,
        'dashboard',
      );
      return c.json(result);
    },
  );
}
