import { HOUR_MS } from '@cobot/shared';

import { childLogger } from '../logger';

import type { AlertService } from '../services/alerts';

const log = childLogger('retention');

/** De hora em hora: cada tarefa decide sozinha se já é hora de agir. */
export const RETENTION_INTERVAL_MS = HOUR_MS;

export interface RetentionTask {
  name: string;
  /** Devolve quantas linhas removeu. Pode lançar — o job trata. */
  run(): Promise<number>;
}

export interface RetentionJobDeps {
  tasks: RetentionTask[];
  alerts?: Pick<AlertService, 'emit'>;
  intervalMs?: number;
}

/**
 * Roda as retenções do PRD §8 num lugar só (`message_cache` 7d, `automod_hits`
 * 30d, rollup de stats 90d) e **avisa quando uma falha**.
 *
 * O alerta é o ponto: o free tier do Supabase são 500 MB e uma retenção que
 * para de rodar em silêncio enche o banco antes de alguém perceber (PRD §11).
 * Cada tarefa é isolada — uma que explode não impede as outras.
 */
export class RetentionJob {
  private readonly deps: RetentionJobDeps;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(deps: RetentionJobDeps) {
    this.deps = deps;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.deps.intervalMs ?? RETENTION_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Uma passada por todas as tarefas. Nunca lança. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const task of this.deps.tasks) {
        try {
          const removed = await task.run();
          if (removed > 0) log.info({ task: task.name, removed }, 'retenção aplicada');
        } catch (error) {
          log.error({ err: error, task: task.name }, 'falha na retenção');
          this.deps.alerts?.emit({
            kind: `retention:${task.name}`,
            title: 'Retenção falhou',
            description:
              `A tarefa \`${task.name}\` não conseguiu podar as linhas antigas. ` +
              'Sem ela o banco cresce até bater na cota do Supabase (500 MB).',
            level: 'danger',
          });
        }
      }
    } finally {
      this.running = false;
    }
  }
}
