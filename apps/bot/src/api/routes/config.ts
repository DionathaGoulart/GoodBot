import { InvalidateInputSchema } from '@goodbot/shared';
import { Hono } from 'hono';

import { childLogger } from '../../logger';
import { validate } from '../validate';

import type { ApiDeps, ApiEnv } from '../context';

const log = childLogger('api');

/**
 * O painel chama isto logo depois de salvar. Passa pelo `ConfigBus` (e não
 * pelo `invalidate` direto) porque é ele o ponto de extensão para
 * `LISTEN/NOTIFY` quando houver mais de um processo — PRD §5.7.
 */
export function createConfigRoutes(deps: ApiDeps): Hono<ApiEnv> {
  return new Hono<ApiEnv>().post('/invalidate', validate('json', InvalidateInputSchema), (c) => {
    const { module } = c.req.valid('json');
    const guild = c.get('guild');
    deps.config.publishInvalidate(guild.id, module);
    log.info({ guildId: guild.id, module: module ?? 'todos' }, 'config invalidado pelo painel');
    return c.json({ ok: true as const });
  });
}
