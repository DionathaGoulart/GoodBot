import { getMeta, setMeta, squadsDailyKey } from '@goodbot/db';
import { MINUTE_MS } from '@goodbot/shared';

import { childLogger } from '../logger';
import { localDayKey, localHour } from '../services/stats';

import type { ConfigService } from '../services/config';
import type { SquadService } from '../services/squads/index';
import type { Db } from '@goodbot/db';
import type { Client, Guild } from 'discord.js';

const log = childLogger('squads-job');

export const SQUADS_INTERVAL_MS = 5 * MINUTE_MS;
/**
 * Hora local a partir da qual o passo diário roda. O aviso de inatividade e
 * as propostas chamam gente pelo nome: nada disso sai de madrugada.
 */
export const DAILY_AT_HOUR = 12;

export interface SquadsJobDeps {
  db: Db;
  client: Client;
  config: ConfigService;
  squads: SquadService;
  /** Guilds atendidas agora (o registro); as outras ficam de fora. */
  guildIds: () => readonly string[];
  intervalMs?: number;
  dailyAtHour?: number;
  now?: () => number;
}

/** O que uma passada fez numa guild; é o que os testes leem. */
export interface SquadsPass {
  expired: number;
  reminded: number;
  started: number;
  released: number;
  /** Chamadas públicas tiradas do ar por a jogatina ter acabado. */
  calls: number;
  /** Presenças abertas e fechadas pela varredura (o que o evento de voz não viu). */
  swept: number;
  /** Criações de voice temporário que não terminaram, resolvidas nesta passada. */
  reconciled: number;
  daily: boolean;
  /** Guias no ar depois do passo diário; 0 fora dele. */
  guides: number;
}

/**
 * O relógio do módulo `squads`, de 5 em 5 minutos, por guild atendida com o
 * módulo ligado. Ele não marca jogatina (quem marca é gente, pelo `/bora`).
 * A ordem de cada passada: expira propostas e pedidos, lembra (e reserva o
 * voice), começa (e move), libera o voice da jogatina encerrada, tira do ar a
 * chamada pública do que acabou, acerta a presença com quem está em voice,
 * resolve voice temporário de criação interrompida e, uma vez por dia, cobra
 * inatividade, põe os guias em dia e roda o match de novo.
 *
 * Cada passo é isolado: falha num não impede os seguintes, e falha numa guild
 * não impede as outras. Rodar duas vezes seguidas não repete nada, porque a
 * trava de cada passo é uma `UPDATE` condicional no banco.
 */
export class SquadsJob {
  private readonly deps: SquadsJobDeps;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(deps: SquadsJobDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.deps.intervalMs ?? SQUADS_INTERVAL_MS);
    this.timer.unref();
    log.info('job de squads iniciado');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Uma passada em todas as guilds atendidas. Nunca lança. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const guildId of this.deps.guildIds()) {
        const guild = this.deps.client.guilds.cache.get(guildId);
        if (!guild) continue;
        await this.runFor(guild).catch((error: unknown) => {
          log.error({ err: error, guildId }, 'falha na passada de squads');
        });
      }
    } finally {
      this.running = false;
    }
  }

  /** Uma guild. `null` quando o módulo está desligado e nada foi tocado. */
  async runFor(guild: Guild): Promise<SquadsPass | null> {
    const config = await this.deps.config.get(guild.id, 'squads');
    if (!config.enabled) return null;
    const { squads } = this.deps;
    const pass: SquadsPass = {
      expired: 0,
      reminded: 0,
      started: 0,
      released: 0,
      calls: 0,
      swept: 0,
      reconciled: 0,
      daily: false,
      guides: 0,
    };

    await this.step(guild, 'expirar propostas e pedidos', async () => {
      pass.expired =
        (await squads.expireProposals(guild.id)) + (await squads.expireRequests(guild.id));
    });
    const due = await this.step(guild, 'ler jogatinas', () => squads.dueSessions(guild.id));
    for (const session of due?.remind ?? []) {
      await this.step(guild, 'lembrar jogatina', async () => {
        if (await squads.remindSession(guild, session)) pass.reminded++;
      });
    }
    for (const session of due?.start ?? []) {
      await this.step(guild, 'começar jogatina', async () => {
        if (await squads.startSession(guild, session)) pass.started++;
      });
    }
    for (const session of due?.release ?? []) {
      await this.step(guild, 'liberar voice', async () => {
        if (await squads.releaseVoice(guild, session)) pass.released++;
      });
    }
    // Depois de liberar: a jogatina com sala já saiu do ar ali, e aqui fica a
    // que acabou no `ends_at` sem nada mais para liberar.
    await this.step(guild, 'fechar chamadas encerradas', async () => {
      pass.calls = await squads.closeFinishedCalls(guild);
    });
    await this.step(guild, 'varrer presença', async () => {
      const swept = await squads.sweepPresence(guild);
      pass.swept = swept.opened + swept.closed;
    });
    await this.step(guild, 'reconciliar voices temporários', async () => {
      pass.reconciled = await squads.reconcileTemporaryVoices(guild);
    });

    await this.step(guild, 'passo diário', async () => {
      pass.daily = await this.daily(guild, pass);
    });
    return pass;
  }

  /**
   * Inatividade, guias e match, uma vez por dia local, depois de
   * `DAILY_AT_HOUR`. O dia fica em `meta` para um restart não repetir a
   * cobrança. A marca vai antes do trabalho: se ele falhar no meio, a próxima
   * tentativa é amanhã, e não a cada 5 minutos.
   */
  private async daily(guild: Guild, pass: SquadsPass): Promise<boolean> {
    const { db, squads } = this.deps;
    const { timezone } = await this.deps.config.getSettings(guild.id);
    const at = new Date(this.now());
    if (localHour(at, timezone) < (this.deps.dailyAtHour ?? DAILY_AT_HOUR)) return false;

    const day = localDayKey(at, timezone);
    const key = squadsDailyKey(guild.id);
    if ((await getMeta<string>(db, key)) === day) return false;
    await setMeta(db, key, day);

    const inactivity = await squads.checkInactivity(guild);
    if (inactivity.warned.length > 0 || inactivity.archived.length > 0) {
      log.info({ guildId: guild.id, ...inactivity }, 'inatividade de squads cobrada');
    }
    // Depois da inatividade, para o squad arquivado agora não ganhar guia.
    await this.step(guild, 'guias dos squads', async () => {
      pass.guides = await squads.syncGuides(guild);
    });
    // Perfil que chegou sem par na hora pode ter ganhado par desde então.
    for (const game of await squads.listGames(guild.id)) {
      await this.step(guild, 'match diário', () => squads.runMatch(guild.id, game.id));
    }
    return true;
  }

  private async step<T>(guild: Guild, name: string, run: () => Promise<T>): Promise<T | null> {
    try {
      return await run();
    } catch (error) {
      log.error({ err: error, guildId: guild.id, step: name }, 'falha num passo do job de squads');
      return null;
    }
  }
}
