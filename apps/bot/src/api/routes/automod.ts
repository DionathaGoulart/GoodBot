import { RaidModeInputSchema } from '@cobot/shared';
import { Hono } from 'hono';

import { childLogger } from '../../logger';
import { validate } from '../validate';

import type { ApiDeps, ApiEnv } from '../context';
import type { RaidModeState } from '@cobot/shared';

const log = childLogger('api');

function toState(deps: ApiDeps, guildId: string): RaidModeState {
  const state = deps.automod.raid.get(guildId);
  if (!state) return { active: false, source: null, until: null };
  return {
    active: true,
    source: state.source,
    until: new Date(state.until).toISOString(),
  };
}

/**
 * O card anti-raid do painel: mesma trava que o `/raid`, pelo mesmo serviço em
 * memória — ligar por um caminho e desligar pelo outro tem que funcionar.
 */
export function createAutomodRoutes(deps: ApiDeps): Hono<ApiEnv> {
  return new Hono<ApiEnv>()
    .get('/raid', (c) => c.json(toState(deps, c.get('guild').id)))
    .post('/raid', validate('json', RaidModeInputSchema), async (c) => {
      const { active, minutes } = c.req.valid('json');
      const guild = c.get('guild');

      if (active) {
        await deps.automod.enableRaidMode(guild, minutes);
      } else {
        await deps.automod.disableRaidMode(guild);
      }
      log.info({ guildId: guild.id, active }, 'modo raid alterado pelo painel');
      return c.json(toState(deps, guild.id));
    });
}
