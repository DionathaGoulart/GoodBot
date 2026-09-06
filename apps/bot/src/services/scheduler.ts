import { claimDueActions, createCase } from '@cobot/db';
import { DEFAULT_REASON, SECOND_MS } from '@cobot/shared';

import { childLogger } from '../logger';
import { fetchMember } from './moderation';

import type { ModlogService } from './modlog';
import type { Db, ScheduledAction } from '@cobot/db';
import type { CaseType } from '@cobot/shared';
import type { Client } from 'discord.js';

const log = childLogger('scheduler');

/** Poll a cada 30 s na tabela, sem cron externo (PRD §5.1). */
export const SCHEDULER_INTERVAL_MS = 30 * SECOND_MS;

/** Só os tipos que esta etapa sabe executar; os outros ficam para as próximas. */
const HANDLED_KINDS = ['unban', 'untimeout'] as const;
type HandledKind = (typeof HANDLED_KINDS)[number];

const CASE_TYPE_BY_KIND: Record<HandledKind, CaseType> = {
  unban: 'unban',
  untimeout: 'untimeout',
};

const REASON_BY_KIND: Record<HandledKind, string> = {
  unban: 'Banimento temporário expirou.',
  untimeout: 'Timeout expirou.',
};

interface ActionPayload {
  targetId?: string;
  targetTag?: string;
  caseNumber?: number;
}

export interface SchedulerDeps {
  db: Db;
  client: Client;
  modlog: ModlogService;
  /** Sobrescreve o intervalo (testes e dev). */
  intervalMs?: number;
  /** Quantas ações uma passada processa. */
  batchSize?: number;
}

/**
 * Desfaz punições temporárias. As ações são tomadas em lote com `for update
 * skip locked` e já marcadas como feitas; falha de execução vira log e não
 * retentativa infinita (ver `claimDueActions`).
 */
export class Scheduler {
  private readonly deps: SchedulerDeps;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(deps: SchedulerDeps) {
    this.deps = deps;
  }

  start(): void {
    if (this.timer) return;
    const interval = this.deps.intervalMs ?? SCHEDULER_INTERVAL_MS;
    this.timer = setInterval(() => void this.tick(), interval);
    this.timer.unref();
    log.info({ intervalMs: interval }, 'scheduler iniciado');
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    log.info('scheduler parado');
  }

  /** Uma passada. Nunca lança: o loop não pode morrer por um erro pontual. */
  async tick(): Promise<number> {
    // Uma passada lenta (rate limit do Discord) não pode empilhar passadas.
    if (this.running) return 0;
    this.running = true;
    try {
      const actions = await claimDueActions(this.deps.db, {
        kinds: HANDLED_KINDS,
        limit: this.deps.batchSize ?? 25,
      });
      for (const action of actions) {
        await this.run(action);
      }
      return actions.length;
    } catch (error) {
      log.error({ err: error }, 'falha na passada do scheduler');
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async run(action: ScheduledAction): Promise<void> {
    const kind = action.kind as HandledKind;
    const payload = action.payload as ActionPayload;
    const targetId = payload.targetId;
    if (!targetId) {
      log.warn({ actionId: action.id, kind }, 'ação agendada sem targetId');
      return;
    }

    try {
      const guild = await this.deps.client.guilds.fetch(action.guildId);
      const bot = this.deps.client.user;
      const reason = REASON_BY_KIND[kind];
      let targetTag = payload.targetTag ?? targetId;

      if (kind === 'unban') {
        const ban = await guild.bans.fetch(targetId).catch(() => null);
        // Alguém já desbaniu na mão: nada a desfazer, e nenhum caso a criar.
        if (!ban) {
          log.debug({ actionId: action.id, targetId }, 'usuário já não estava banido');
          return;
        }
        targetTag = ban.user.tag;
        await guild.bans.remove(targetId, reason);
      } else {
        const member = await fetchMember(guild, targetId);
        if (!member) {
          log.debug({ actionId: action.id, targetId }, 'membro saiu antes do timeout expirar');
          return;
        }
        targetTag = member.user.tag;
        // O Discord já expirou o timeout sozinho; isto só garante o estado.
        if (member.communicationDisabledUntil) {
          await member.timeout(null, reason);
        }
      }

      const kase = await createCase(this.deps.db, {
        guildId: action.guildId,
        type: CASE_TYPE_BY_KIND[kind],
        targetId,
        targetTag,
        actorId: bot?.id ?? this.deps.client.application?.id ?? targetId,
        actorTag: bot?.tag ?? 'CoBot',
        reason: reason || DEFAULT_REASON,
        durationMs: null,
        expiresAt: null,
        source: 'command',
      });
      await this.deps.modlog.postCase(kase);

      log.info(
        { actionId: action.id, kind, targetId, caseNumber: kase.caseNumber },
        'ação agendada executada',
      );
    } catch (error) {
      log.error({ err: error, actionId: action.id, kind, targetId }, 'falha ao executar ação');
    }
  }
}
