import { describe, expect, it, vi } from 'vitest';

import { RetentionJob } from './retention';

describe('RetentionJob', () => {
  it('roda todas as tarefas na ordem declarada', async () => {
    const ordem: string[] = [];
    const job = new RetentionJob({
      tasks: [
        {
          name: 'a',
          run: () => {
            ordem.push('a');
            return Promise.resolve(1);
          },
        },
        {
          name: 'b',
          run: () => {
            ordem.push('b');
            return Promise.resolve(0);
          },
        },
      ],
    });

    await job.tick();
    expect(ordem).toEqual(['a', 'b']);
  });

  it('uma tarefa que falha não impede as seguintes e vira alerta', async () => {
    const emit = vi.fn();
    const depois = vi.fn(() => Promise.resolve(0));
    const job = new RetentionJob({
      alerts: { emit },
      tasks: [
        { name: 'quebrada', run: () => Promise.reject(new Error('banco fora')) },
        { name: 'seguinte', run: depois },
      ],
    });

    await expect(job.tick()).resolves.toBeUndefined();
    expect(depois).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'retention:quebrada', level: 'danger' }),
    );
  });

  it('não roda duas passadas ao mesmo tempo', async () => {
    let running = 0;
    let peak = 0;
    const job = new RetentionJob({
      tasks: [
        {
          name: 'lenta',
          run: async () => {
            running += 1;
            peak = Math.max(peak, running);
            await Promise.resolve();
            running -= 1;
            return 0;
          },
        },
      ],
    });

    await Promise.all([job.tick(), job.tick()]);
    expect(peak).toBe(1);
  });
});
