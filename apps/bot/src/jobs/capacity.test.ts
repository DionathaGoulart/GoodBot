import { describe, expect, it, vi } from 'vitest';

import { CAPACITY_REPEAT_MS, CapacityJob } from './capacity';

import type { StorageUsage } from '@goodbot/db';

const MB = 1024 * 1024;

function montar(inicial: { rss: number; banco: number; cache?: number }) {
  const estado = { ...inicial, agora: Date.UTC(2026, 8, 16, 12), falhaNoBanco: false };
  const emit = vi.fn();
  const job = new CapacityJob({
    alerts: { emit },
    readRss: () => estado.rss,
    readStorage: (): Promise<StorageUsage> =>
      estado.falhaNoBanco
        ? Promise.reject(new Error('banco fora'))
        : Promise.resolve({
            databaseBytes: estado.banco,
            messageCacheBytes: estado.cache ?? 0,
          }),
    now: () => estado.agora,
  });
  const tipos = () => emit.mock.calls.map(([input]) => (input as { kind: string }).kind);
  return { estado, emit, job, tipos };
}

describe('CapacityJob', () => {
  it('abaixo das duas linhas não avisa', async () => {
    const { job, emit } = montar({ rss: 120 * MB, banco: 13 * MB });
    await job.tick();
    expect(emit).not.toHaveBeenCalled();
  });

  it('avisa a RAM acima de 300 MB com o número e o que fazer', async () => {
    const { job, emit } = montar({ rss: 312 * MB, banco: 13 * MB });
    await job.tick();

    expect(emit).toHaveBeenCalledOnce();
    const alerta = emit.mock.calls[0]?.[0] as { kind: string; description: string };
    expect(alerta.kind).toBe('capacity:memory');
    expect(alerta.description).toContain('312 MB');
    expect(alerta.description).toContain('cache de mensagens');
  });

  it('avisa o banco acima de 400 MB dizendo quanto é do cache de mensagens', async () => {
    const { job, emit } = montar({ rss: 120 * MB, banco: 410 * MB, cache: 290 * MB });
    await job.tick();

    const alerta = emit.mock.calls[0]?.[0] as { kind: string; description: string };
    expect(alerta.kind).toBe('capacity:database');
    expect(alerta.description).toContain('410 MB de 500 MB');
    expect(alerta.description).toContain('290 MB');
  });

  it('acima da linha repete uma vez por dia, não a cada medição', async () => {
    const { job, estado, tipos } = montar({ rss: 320 * MB, banco: 13 * MB });

    await job.tick();
    estado.agora += CAPACITY_REPEAT_MS - 1;
    await job.tick();
    expect(tipos()).toEqual(['capacity:memory']);

    estado.agora += 1;
    await job.tick();
    expect(tipos()).toEqual(['capacity:memory', 'capacity:memory']);
  });

  it('desceu e subiu de novo: avisa na hora', async () => {
    const { job, estado, tipos } = montar({ rss: 320 * MB, banco: 13 * MB });

    await job.tick();
    estado.rss = 200 * MB;
    await job.tick();
    estado.rss = 330 * MB;
    await job.tick();

    expect(tipos()).toEqual(['capacity:memory', 'capacity:memory']);
  });

  it('banco fora não impede o aviso de RAM e não lança', async () => {
    const { job, estado, tipos } = montar({ rss: 320 * MB, banco: 0 });
    estado.falhaNoBanco = true;

    await expect(job.tick()).resolves.toBeUndefined();
    expect(tipos()).toEqual(['capacity:memory']);
  });
});
