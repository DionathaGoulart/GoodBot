import {
  BOT_MEMORY_BUDGET_BYTES,
  BOT_MEMORY_LIMIT_BYTES,
  DATABASE_QUOTA_BYTES,
  DATABASE_WARNING_BYTES,
  DAY_MS,
  MINUTE_MS,
} from '@goodbot/shared';

import { childLogger } from '../logger';

import type { AlertInput, AlertService } from '../services/alerts';
import type { StorageUsage } from '@goodbot/db';

const log = childLogger('capacity');

/** De quanto em quanto tempo a RAM e o banco são medidos. */
export const CAPACITY_INTERVAL_MS = 15 * MINUTE_MS;
/**
 * Enquanto continuar acima da linha, o alerta repete uma vez por dia. Mais do
 * que isso vira ruído, e alerta que toca toda hora é alerta que se aprende a
 * ignorar.
 */
export const CAPACITY_REPEAT_MS = DAY_MS;

type CapacityKind = 'memory' | 'database';

export interface CapacityJobDeps {
  /** Lê o uso do banco; em produção, `getStorageUsage` sobre o `Db` do bot. */
  readStorage: () => Promise<StorageUsage>;
  alerts?: Pick<AlertService, 'emit'>;
  readRss?: () => number;
  intervalMs?: number;
  now?: () => number;
}

/** `312 MB`: o alerta é lido no celular, sem casa decimal. */
function mb(bytes: number): string {
  return `${String(Math.round(bytes / (1024 * 1024)))} MB`;
}

/**
 * Vigia os dois limites que param o bot inteiro (PRD §7.2): a RAM do container
 * (384 MB, e o Docker mata o processo) e a cota do Supabase (500 MB, e o banco
 * passa a só aceitar leitura).
 *
 * Os números já aparecem no `/admin`, mas ninguém abre o painel todo dia. O
 * alerta chega antes do limite, com folga para agir, e diz o que fazer: a
 * alavanca dos dois é o cache de mensagens dos servidores que mais falam.
 *
 * Avisa quando cruza a linha e repete uma vez por dia enquanto continuar
 * acima. Voltou para baixo, a memória do aviso some, e a próxima subida avisa
 * na hora.
 */
export class CapacityJob {
  private readonly deps: CapacityJobDeps;
  private readonly now: () => number;
  private readonly lastAlertAt = new Map<CapacityKind, number>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(deps: CapacityJobDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.deps.intervalMs ?? CAPACITY_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Uma medição. Nunca lança. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const rss = (this.deps.readRss ?? (() => process.memoryUsage().rss))();
      this.check('memory', rss >= BOT_MEMORY_BUDGET_BYTES, {
        title: 'RAM do bot acima do orçamento',
        description:
          `O bot está usando ${mb(rss)} de RAM. O orçamento é ${mb(BOT_MEMORY_BUDGET_BYTES)} ` +
          `e o container é derrubado em ${mb(BOT_MEMORY_LIMIT_BYTES)}. Em /admin, a tabela de ` +
          'uso mostra quem mais manda mensagens: desligue o cache de mensagens dos maiores.',
      });

      let storage: StorageUsage;
      try {
        storage = await this.deps.readStorage();
      } catch (error) {
        // Banco fora já tem alerta próprio (`watchDatabase`); aqui só registra.
        log.warn({ err: error }, 'não deu para medir o tamanho do banco');
        return;
      }
      this.check('database', storage.databaseBytes >= DATABASE_WARNING_BYTES, {
        title: 'Banco perto da cota do Supabase',
        description:
          `O banco está com ${mb(storage.databaseBytes)} de ${mb(DATABASE_QUOTA_BYTES)}. ` +
          'Com a cota cheia ele passa a só aceitar leitura. O cache de mensagens ocupa ' +
          `${mb(storage.messageCacheBytes)} disso: em /admin dá para desligá-lo nos servidores ` +
          'que mais guardam.',
      });
    } finally {
      this.running = false;
    }
  }

  private check(
    kind: CapacityKind,
    over: boolean,
    alert: Pick<AlertInput, 'title' | 'description'>,
  ): void {
    if (!over) {
      this.lastAlertAt.delete(kind);
      return;
    }
    const at = this.now();
    const last = this.lastAlertAt.get(kind);
    if (last !== undefined && at - last < CAPACITY_REPEAT_MS) return;

    this.lastAlertAt.set(kind, at);
    log.warn({ kind }, alert.title);
    this.deps.alerts?.emit({ ...alert, kind: `capacity:${kind}`, level: 'warning' });
  }
}
