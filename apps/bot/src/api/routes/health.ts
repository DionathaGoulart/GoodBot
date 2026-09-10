import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { HOUR_MS, VERSION } from '@goodbot/shared';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { metrics } from '../../metrics';
import { isAuthorized } from '../middleware/auth';

import type { ApiDeps, ApiEnv } from '../context';
import type { BackupHealth, HealthResponse, QueueHealth } from '@goodbot/shared';
import type { Client } from 'discord.js';

/** Um dump com mais de 48h significa que o job de backup parou (PRD §11). */
export const BACKUP_STALE_AFTER_MS = 48 * HOUR_MS;

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
    const latencyMs = Math.round(performance.now() - start);
    metrics.dbLatency.observe(latencyMs);
    return { ok: true, latencyMs };
  } catch {
    return { ok: false, latencyMs: null };
  }
}

/**
 * O dump mais recente no volume `backups`, montado read-only no container do
 * bot. Se o diretório não existe (dev, ou VM sem o serviço `backup`), o painel
 * simplesmente não mostra o card.
 */
export async function readBackupHealth(
  directory: string,
  now: () => number = Date.now,
): Promise<BackupHealth | undefined> {
  try {
    const files = (await readdir(directory)).filter((name) => name.endsWith('.sql.gz'));
    if (files.length === 0) return { at: null, sizeBytes: null, fresh: false };

    let newest: { at: number; size: number } | null = null;
    for (const name of files) {
      const info = await stat(join(directory, name));
      if (!newest || info.mtimeMs > newest.at) newest = { at: info.mtimeMs, size: info.size };
    }
    if (!newest) return { at: null, sizeBytes: null, fresh: false };

    return {
      at: new Date(newest.at).toISOString(),
      sizeBytes: newest.size,
      fresh: now() - newest.at < BACKUP_STALE_AFTER_MS,
    };
  } catch {
    return undefined;
  }
}

export interface HealthRoutesOptions {
  deps: ApiDeps;
  token: string;
  /** Quantas guilds o bot deveria ter no cache (hoje: `GUILD_ID`). */
  expectedGuilds: number;
  startedAt?: number;
  /** Leitor das filas; sem ele o campo `queues` some da resposta. */
  queues?: () => QueueHealth;
  /** Diretório do volume de backups (`/backups` na VM). */
  backupDir?: string;
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
    const memory = process.memoryUsage();
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
      process: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        nodeVersion: process.version,
        commit: process.env.GIT_SHA ?? null,
      },
      ...(options.queues ? { queues: options.queues() } : {}),
      ...(options.backupDir ? { backup: await readBackupHealth(options.backupDir) } : {}),
    };
    return c.json(body);
  });
}
