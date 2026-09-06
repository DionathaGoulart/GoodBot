import { VERSION } from '@cobot/shared';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { isAuthorized } from '../middleware/auth';

import type { ApiDeps, ApiEnv } from '../context';
import type { HealthResponse } from '@cobot/shared';
import type { Client } from 'discord.js';

/** `Status` do discord.js → o enum público do `HealthResponse`. */
export function gatewayStatus(client: Client): HealthResponse['gateway']['status'] {
  if (client.isReady()) return 'ready';
  // `ws.status` é numérico e muda entre versões; o que importa ao painel é se
  // já houve conexão alguma vez.
  return client.ws.status === 0 ? 'ready' : client.uptime === null ? 'connecting' : 'reconnecting';
}

async function databaseHealth(db: ApiDeps['db']): Promise<HealthResponse['database']> {
  const start = performance.now();
  try {
    await db.execute(sql`select 1`);
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch {
    return { ok: false, latencyMs: null };
  }
}

export interface HealthRoutesOptions {
  deps: ApiDeps;
  token: string;
  /** Quantas guilds o bot deveria ter no cache (hoje: `GUILD_ID`). */
  expectedGuilds: number;
  startedAt?: number;
}

/**
 * `/health` é a única rota sem auth, e sem token responde só `{ok: true}`:
 * o healthcheck do Docker e o do Caddy precisam dela, e nada além disso deve
 * vazar para quem só achou o subdomínio (PRD §5.7).
 */
export function createHealthRoutes(options: HealthRoutesOptions): Hono<ApiEnv> {
  const { deps, token, expectedGuilds } = options;
  const startedAt = options.startedAt ?? Date.now();

  return new Hono<ApiEnv>().get('/', async (c) => {
    if (!isAuthorized(c.req.header('authorization'), token)) {
      return c.json({ ok: true });
    }

    const database = await databaseHealth(deps.db);
    const status = gatewayStatus(deps.client);
    const body: HealthResponse = {
      ok: status === 'ready' && database.ok,
      version: VERSION,
      uptimeMs: Date.now() - startedAt,
      gateway: {
        status,
        pingMs:
          Number.isFinite(deps.client.ws.ping) && deps.client.ws.ping >= 0
            ? Math.round(deps.client.ws.ping)
            : null,
      },
      database,
      guilds: { cached: deps.client.guilds.cache.size, expected: expectedGuilds },
    };
    return c.json(body);
  });
}
