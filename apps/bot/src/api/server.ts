import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requestId } from 'hono/request-id';

import { childLogger } from '../logger';
import { apiError, mapError } from './errors';
import { bearerAuth } from './middleware/auth';
import { withGuild } from './middleware/guild';
import {
  IP_LIMIT_PER_MINUTE,
  ROUTE_LIMIT_PER_MINUTE,
  createRateLimiter,
  rateLimit,
} from './middleware/rate-limit';
import { createConfigRoutes } from './routes/config';
import { createGuildRoutes } from './routes/guild';
import { createHealthRoutes } from './routes/health';
import { createMessageRoutes } from './routes/messages';
import { createModerationRoutes } from './routes/moderation';

import type { ApiDeps, ApiEnv } from './context';
import type { ServerType } from '@hono/node-server';

const log = childLogger('api');

/** Teto de corpo aceito (PRD §7.3): nenhum payload legítimo chega perto. */
export const MAX_BODY_BYTES = 256 * 1024;

export interface ApiServerOptions {
  deps: ApiDeps;
  token: string;
  port: number;
  /** Guilds esperadas no cache — hoje uma (`GUILD_ID`). */
  expectedGuilds?: number;
}

/**
 * A API do bot (PRD §5.7). Desde a v1.1 ela é pública atrás do Caddy, então
 * a ordem dos middlewares importa: rate limit e body cap vêm antes da auth,
 * para que uma inundação de requisições sem token custe o mínimo possível.
 */
export function createApiApp(options: ApiServerOptions): Hono<ApiEnv> {
  const { deps, token } = options;

  const app = new Hono<ApiEnv>();

  const ipLimiter = createRateLimiter({ limit: IP_LIMIT_PER_MINUTE });
  const routeLimiter = createRateLimiter({ limit: ROUTE_LIMIT_PER_MINUTE });

  app.use('*', requestId());
  app.use('*', rateLimit({ ipLimiter, routeLimiter }));
  app.use(
    '*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json(apiError('BODY_TOO_LARGE', 'Corpo da requisição grande demais.'), 413),
    }),
  );

  // Log de acesso: método, rota e status. Nunca headers — é lá que mora o token.
  app.use('*', async (c, next) => {
    const start = performance.now();
    await next();
    log.debug(
      {
        requestId: c.get('requestId'),
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        status: c.res.status,
        durationMs: Math.round(performance.now() - start),
      },
      'requisição',
    );
  });

  app.route(
    '/health',
    createHealthRoutes({ deps, token, expectedGuilds: options.expectedGuilds ?? 1 }),
  );

  // Tudo abaixo de /guilds exige o Bearer e uma guild que o bot conheça.
  const guilds = new Hono<ApiEnv>();
  guilds.use('*', bearerAuth(token));
  guilds.use('/:guildId/*', withGuild(deps));
  guilds.route('/:guildId', createGuildRoutes());
  guilds.route('/:guildId/moderation', createModerationRoutes(deps));
  guilds.route('/:guildId/config', createConfigRoutes(deps));
  guilds.route('/:guildId', createMessageRoutes(deps));
  app.route('/guilds', guilds);

  // Sem listagem de rotas: qualquer outro caminho é um 404 igual ao dos outros.
  app.notFound((c) => c.json(apiError('NOT_FOUND', 'Rota não encontrada.'), 404));

  app.onError((error, c) => {
    const mapped = mapError(error, c.get('requestId') ?? '');
    return c.json(mapped.body, mapped.status, mapped.headers ?? {});
  });

  return app;
}

export interface ApiServer {
  app: Hono<ApiEnv>;
  start(): void;
  stop(): Promise<void>;
}

export function createApiServer(options: ApiServerOptions): ApiServer {
  const app = createApiApp(options);
  let server: ServerType | null = null;

  return {
    app,
    start() {
      if (server) return;
      // `0.0.0.0` porque só o Caddy alcança o container: o bot não publica
      // porta no host (PRD §7.3).
      server = serve({ fetch: app.fetch, port: options.port, hostname: '0.0.0.0' }, (info) => {
        log.info({ port: info.port }, 'API interna ouvindo');
      });
    },
    stop() {
      const current = server;
      server = null;
      if (!current) return Promise.resolve();
      return new Promise((resolve) => {
        current.close(() => resolve());
      });
    },
  };
}
