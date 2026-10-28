import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BACKUP_MIN_BYTES,
  BACKUP_STALE_AFTER_MS,
  createHealthRoutes,
  readBackupHealth,
} from './health';

const AGORA = new Date('2026-09-16T12:00:00Z').getTime();
const HORA = 60 * 60 * 1000;

it('readiness exige token e só retorna 200 com gateway e banco disponíveis', async () => {
  const execute = vi.fn().mockResolvedValue([]);
  const isReady = vi.fn().mockReturnValue(true);
  const routes = createHealthRoutes({
    token: 'test-token',
    expectedGuilds: () => 1,
    deps: { db: { execute }, client: { isReady } } as never,
  });
  expect((await routes.request('/ready')).status).toBe(401);
  expect(execute).not.toHaveBeenCalled();
  const request = () =>
    routes.request('/ready', { headers: { authorization: 'Bearer test-token' } });
  expect((await request()).status).toBe(200);
  isReady.mockReturnValue(false);
  expect((await request()).status).toBe(503);
  isReady.mockReturnValue(true);
  execute.mockRejectedValue(new Error('banco fora'));
  expect((await request()).status).toBe(503);
});

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'goodbot-backups-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Cria um dump com `bytes` de tamanho e data de modificação `at`. */
async function dump(name: string, bytes: number, at: number): Promise<void> {
  const path = join(dir, name);
  await writeFile(path, Buffer.alloc(bytes));
  await utimes(path, new Date(at), new Date(at));
}

describe('readBackupHealth', () => {
  it('devolve o dump mais recente e marca como em dia', async () => {
    await dump('daily-20260914-061244.sql.gz', 40_000, AGORA - 50 * HORA);
    await dump('daily-20260915-061244.sql.gz', 41_000, AGORA - 6 * HORA);

    const health = await readBackupHealth(dir, () => AGORA);

    expect(health).toEqual({
      at: new Date(AGORA - 6 * HORA).toISOString(),
      sizeBytes: 41_000,
      fresh: true,
    });
  });

  it('ignora um dump vazio mais novo que o último válido', async () => {
    await dump('daily-20260913-061244.sql.gz', 40_000, AGORA - 72 * HORA);
    // O gzip de uma entrada vazia: era o que o `pg_dump` abortado deixava.
    await dump('daily-20260916-061245.sql.gz', 20, AGORA - HORA);

    const health = await readBackupHealth(dir, () => AGORA);

    expect(health?.sizeBytes).toBe(40_000);
    expect(health?.fresh).toBe(false);
  });

  it('sem nenhum dump válido não finge que existe backup', async () => {
    await dump('daily-20260915-061244.sql.gz', 20, AGORA - HORA);
    await dump('daily-20260916-061245.sql.gz', BACKUP_MIN_BYTES - 1, AGORA - HORA);

    expect(await readBackupHealth(dir, () => AGORA)).toEqual({
      at: null,
      sizeBytes: null,
      fresh: false,
    });
  });

  it('dump com mais de 48h não está em dia', async () => {
    await dump('daily-20260914-061244.sql.gz', 40_000, AGORA - BACKUP_STALE_AFTER_MS - 1);

    expect((await readBackupHealth(dir, () => AGORA))?.fresh).toBe(false);
  });

  it('ignora o que não é dump e diretório que não existe', async () => {
    await dump('daily-20260916-061245.sql.gz.part', 40_000, AGORA - HORA);

    expect(await readBackupHealth(dir, () => AGORA)).toEqual({
      at: null,
      sizeBytes: null,
      fresh: false,
    });
    expect(await readBackupHealth(join(dir, 'nao-existe'), () => AGORA)).toBeUndefined();
  });
});
