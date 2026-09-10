import { rollupHourlyBuckets } from '@goodbot/db';
import { DAY_MS, HOUR_MS } from '@goodbot/shared';

import { childLogger } from '../logger';
import { localDayKey } from '../services/stats';

import type { ConfigService } from '../services/config';
import type { Db } from '@goodbot/db';
import type { Client } from 'discord.js';

const log = childLogger('stats-rollup');

/** De hora em hora o job olha o relógio; só age uma vez por dia. */
export const CHECK_INTERVAL_MS = HOUR_MS;
/** Hora local em que o rollup roda: madrugada, longe do pico (PRD §5.6). */
export const RUN_AT_HOUR = 4;

export interface StatsRollupDeps {
  db: Db;
  client: Client;
  config: ConfigService;
  checkIntervalMs?: number;
  runAtHour?: number;
  now?: () => number;
}

/**
 * Job noturno de retenção das stats (PRD §5.6): buckets horários com mais de
 * `stats.hourlyRetentionDays` viram um bucket diário e os horários somem. Sem
 * isto, `stat_buckets` cresce sem teto — e o Postgres do free tier tem 500 MB
 * (PRD §7.2).
 */
export class StatsRollupJob {
  private readonly deps: StatsRollupDeps;
  private readonly now: () => number;
  /** Último dia local em que o rollup já rodou, por guild. */
  private readonly lastRun = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(deps: StatsRollupDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(
      () => void this.tick(),
      this.deps.checkIntervalMs ?? CHECK_INTERVAL_MS,
    );
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Uma passada: roda o que ainda não rodou hoje. Nunca lança. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const guild of this.deps.client.guilds.cache.values()) {
        await this.runFor(guild.id).catch((error: unknown) => {
          log.error({ err: error, guildId: guild.id }, 'falha no rollup de stats');
        });
      }
    } finally {
      this.running = false;
    }
  }

  /** `force` ignora a janela da madrugada (usado pelo `/stats` e por testes). */
  async runFor(guildId: string, options: { force?: boolean } = {}): Promise<number> {
    const config = await this.deps.config.get(guildId, 'stats');
    if (!config.enabled) return 0;

    const { timezone } = await this.deps.config.getSettings(guildId);
    const at = new Date(this.now());
    const day = localDayKey(at, timezone);

    if (!options.force) {
      if (this.lastRun.get(guildId) === day) return 0;
      if (localHour(at, timezone) < (this.deps.runAtHour ?? RUN_AT_HOUR)) return 0;
    }
    this.lastRun.set(guildId, day);

    const before = new Date(at.getTime() - config.hourlyRetentionDays * DAY_MS);
    const result = await rollupHourlyBuckets(this.deps.db, { guildId, before, timezone });
    if (result.removed > 0) {
      log.info({ guildId, ...result, before }, 'buckets horários agregados em diários');
    }
    return result.removed;
  }
}

/** Hora local (0–23) no fuso da guild; fuso inválido cai em UTC. */
function localHour(at: Date, timeZone: string): number {
  try {
    return Number(
      new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: '2-digit' }).format(at),
    );
  } catch {
    return at.getUTCHours();
  }
}
