import { HOUR_MS } from '@goodbot/shared';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requestId } from 'hono/request-id';

import { childLogger } from '../logger';
import { metrics } from '../metrics';
import { apiError, mapError } from './errors';
import { bearerAuth } from './middleware/auth';
import { withGuild } from './middleware/guild';
import {
  IP_LIMIT_PER_MINUTE,
  ROUTE_LIMIT_PER_MINUTE,
  TRUSTED_IP_LIMIT_PER_MINUTE,
  TRUSTED_ROUTE_LIMIT_PER_MINUTE,
  createRateLimiter,
  rateLimit,
} from './middleware/rate-limit';
import { createAutomodRoutes } from './routes/automod';
import { createCaseRoutes } from './routes/cases';
import { createChannelRoutes } from './routes/channels';
import { createCommandRoutes } from './routes/commands';
import { createConfigRoutes } from './routes/config';
import { createEventRoutes } from './routes/events';
import { createExpressionRoutes } from './routes/expressions';
import { createGuildRoutes } from './routes/guild';
import { createHealthRoutes } from './routes/health';
import { createInviteRoutes } from './routes/invites';
import { createMemberRoutes } from './routes/members';
import { createMessageRoutes } from './routes/messages';
import { createMetricsRoutes } from './routes/metrics';
import { createModerationRoutes } from './routes/moderation';
import { createRoleRoutes } from './routes/roles';
import { createSocialRoutes } from './routes/social';

import type { ApiDeps, ApiEnv } from './context';
import type { AlertService } from '../services/alerts';
import type { QueueHealth } from '@goodbot/shared';
import type { ServerType } from '@hono/node-server';
import type { Context } from 'hono';

const log = childLogger('api');

/** Teto de corpo aceito (PRD §7.3): nenhum payload legítimo chega perto. */
export const MAX_BODY_BYTES = 256 * 1024;

/**
 * Exceção ao teto acima: as rotas que carregam imagem. Uma imagem de 8 MB (o
 * limite do Discord para ícone, banner e capa de evento) vira ~11 MB em
 * base64. Toda outra rota continua em 256 KB.
 */
export const MAX_UPLOAD_BODY_BYTES = 12 * 1024 * 1024;

/**
 * Quem recebe data URL: as configurações do servidor (ícone e banner), a capa
 * do evento agendado e o upload de emoji e sticker. Emoji e sticker são bem
 * menores (256 KB e 512 KB), mas já passam do teto padrão depois da base64.
 */
const GUILD = String.raw`/guilds/\d{17,20}`;
const UPLOAD_ROUTES: { method: string; path: RegExp }[] = [
  { method: 'PATCH', path: new RegExp(`^${GUILD}/?$`) },
  { method: 'POST', path: new RegExp(`^${GUILD}/events/?$`) },
  { method: 'PATCH', path: new RegExp(String.raw`^${GUILD}/events/\d{17,20}/?$`) },
  { method: 'POST', path: new RegExp(`^${GUILD}/expressions/(emojis|stickers)/?$`) },
];

export function isImageUploadRoute(method: string, path: string): boolean {
  return UPLOAD_ROUTES.some((route) => route.method === method && route.path.test(path));
}

/** 401 numa hora que já é sondagem de token e não dedo gordo (PRD §11). */
export const UNAUTHORIZED_ALERT_THRESHOLD = 50;

export interface ApiServerOptions {
  deps: ApiDeps;
  token: string;
  port: number;
  /** Guilds esperadas no cache — hoje uma (`GUILD_ID`). */
  expectedGuilds?: number;
  /** Filas do bot, para o `/health` e os gauges do `/metrics`. */
  queues?: () => QueueHealth;
  /** Volume de backups montado read-only (`/backups`); ausente em dev. */
  backupDir?: string;
  alerts?: Pick<AlertService, 'emit'>;
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
  const trustedIpLimiter = createRateLimiter({ limit: TRUSTED_IP_LIMIT_PER_MINUTE });
  const trustedRouteLimiter = createRateLimiter({ limit: TRUSTED_ROUTE_LIMIT_PER_MINUTE });

  app.use('*', requestId());
  app.use(
    '*',
    rateLimit({ ipLimiter, routeLimiter, trustedIpLimiter, trustedRouteLimiter, token }),
  );
  const tooLarge = (c: Context) =>
    c.json(apiError('BODY_TOO_LARGE', 'Corpo da requisição grande demais.'), 413);
  const standardBody = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge });
  const uploadBody = bodyLimit({ maxSize: MAX_UPLOAD_BODY_BYTES, onError: tooLarge });
  app.use('*', (c, next) => {
    const path = new URL(c.req.url).pathname;
    return isImageUploadRoute(c.req.method, path) ? uploadBody(c, next) : standardBody(c, next);
  });

  // Log de acesso: método, rota e status. Nunca headers — é lá que mora o token.
  // O `fail2ban` da VM lê justamente estas linhas (nível `warn` no 401).
  const probes = createProbeCounter(options.alerts);
  app.use('*', async (c, next) => {
    const start = performance.now();
    await next();

    const path = new URL(c.req.url).pathname;
    const status = c.res.status;
    const durationMs = Math.round(performance.now() - start);
    // Rota que não existe vira um label só: senão qualquer caminho inventado
    // por um estranho abriria uma série nova no `/metrics`.
    const route = status === 404 ? '(desconhecida)' : routeLabel(path);
    metrics.apiRequests.inc({ status: String(status) });
    metrics.apiLatency.observe(durationMs, { route });

    const entry = { requestId: c.get('requestId'), method: c.req.method, path, status, durationMs };
    if (status === 401) {
      metrics.apiUnauthorized.inc();
      probes.record();
      // `warn` de propósito: é o que o filtro do fail2ban procura no log.
      log.warn(entry, 'requisição não autorizada');
      return;
    }
    log.debug(entry, 'requisição');
  });

  app.route(
    '/health',
    createHealthRoutes({
      deps,
      token,
      expectedGuilds: options.expectedGuilds ?? 1,
      queues: options.queues,
      backupDir: options.backupDir,
    }),
  );

  // `/metrics` não é de guild, mas exige o mesmo Bearer (PRD §7.3).
  const metricsApp = new Hono<ApiEnv>();
  metricsApp.use('*', bearerAuth(token));
  metricsApp.route('/', createMetricsRoutes());
  app.route('/metrics', metricsApp);

  // Tudo abaixo de /guilds exige o Bearer e uma guild que o bot conheça.
  const guilds = new Hono<ApiEnv>();
  guilds.use('*', bearerAuth(token));
  guilds.use('/:guildId/*', withGuild(deps));
  guilds.route('/:guildId', createGuildRoutes(deps));
  guilds.route('/:guildId/moderation', createModerationRoutes(deps));
  guilds.route('/:guildId/cases', createCaseRoutes(deps));
  guilds.route('/:guildId/config', createConfigRoutes(deps));
  guilds.route('/:guildId/commands', createCommandRoutes(deps));
  guilds.route('/:guildId/automod', createAutomodRoutes(deps));
  guilds.route('/:guildId/roles', createRoleRoutes(deps));
  guilds.route('/:guildId/channels', createChannelRoutes(deps));
  guilds.route('/:guildId/members', createMemberRoutes(deps));
  guilds.route('/:guildId/social', createSocialRoutes(deps));
  guilds.route('/:guildId/invites', createInviteRoutes(deps));
  guilds.route('/:guildId/events', createEventRoutes(deps));
  guilds.route('/:guildId/expressions', createExpressionRoutes(deps));
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

/**
 * Conta 401 numa janela de uma hora e avisa uma vez por janela ao cruzar o
 * limiar. Complementa o fail2ban: ele bane o IP, isto avisa o humano.
 */
function createProbeCounter(alerts?: Pick<AlertService, 'emit'>) {
  let count = 0;
  let windowStart = Date.now();
  let alerted = false;

  return {
    record(): void {
      const at = Date.now();
      if (at - windowStart >= HOUR_MS) {
        count = 0;
        windowStart = at;
        alerted = false;
      }
      count += 1;
      if (count < UNAUTHORIZED_ALERT_THRESHOLD || alerted) return;
      alerted = true;
      log.warn({ count }, 'sondagem do token da API');
      alerts?.emit({
        kind: 'api-probe',
        title: 'Sondagem do token da API',
        description:
          `A API respondeu **${String(count)}** vezes com 401 na última hora. ` +
          'Confira o `fail2ban` e considere rotacionar o `INTERNAL_API_TOKEN` (runbook).',
        level: 'danger',
      });
    },
  };
}

/** Caminho normalizado como label de métrica (cardinalidade baixa). */
function routeLabel(path: string): string {
  return path.replace(/\/\d{17,20}(?=\/|$)/g, '/:id');
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
