import { claimDueActions, completeReminder, createCase, getReminder } from '@goodbot/db';
import { DEFAULT_REASON, SECOND_MS } from '@goodbot/shared';

import { botFooter, code, infoEmbed } from '../lib/embeds';
import { logEmbed } from '../lib/log-embeds';
import { childLogger } from '../logger';
import { announceLock, isLockable } from './locks';
import { fetchMember } from './moderation';

import type { AutoroleService } from './autorole';
import type { ConfigService } from './config';
import type { LockService } from './locks';
import type { ModlogService } from './modlog';
import type { PollService } from './polls';
import type { Db, ScheduledAction } from '@goodbot/db';
import type { CaseType } from '@goodbot/shared';
import type { Client } from 'discord.js';

const log = childLogger('scheduler');

/** Poll a cada 30 s na tabela, sem cron externo (PRD §5.1). */
export const SCHEDULER_INTERVAL_MS = 30 * SECOND_MS;

const HANDLED_KINDS = [
  'unban',
  'untimeout',
  'unlock',
  'reminder',
  'poll_close',
  'autorole',
] as const;
type HandledKind = (typeof HANDLED_KINDS)[number];

/** Kinds que desfazem uma punição e por isso viram caso. */
type UndoKind = 'unban' | 'untimeout';

const CASE_TYPE_BY_KIND: Record<UndoKind, CaseType> = {
  unban: 'unban',
  untimeout: 'untimeout',
};

const REASON_BY_KIND: Record<UndoKind, string> = {
  unban: 'Banimento temporário expirou.',
  untimeout: 'Timeout expirou.',
};

const AUTO_UNLOCK_REASON = 'Lock temporário expirou.';

interface ActionPayload {
  targetId?: string;
  targetTag?: string;
  caseNumber?: number;
  /** `unlock`. */
  channelId?: string;
  /** `reminder`. */
  reminderId?: number;
  /** `poll_close`. */
  pollId?: string;
}

export interface SchedulerDeps {
  db: Db;
  client: Client;
  config: ConfigService;
  modlog: ModlogService;
  locks: LockService;
  polls: PollService;
  autorole: AutoroleService;
  /** Sobrescreve o intervalo (testes e dev). */
  intervalMs?: number;
  /** Quantas ações uma passada processa. */
  batchSize?: number;
}

/**
 * Executa o que foi agendado: desfazer punições temporárias, destrancar
 * canais, entregar lembretes, encerrar enquetes e aplicar o autorole atrasado.
 * As ações são tomadas em lote com `for update skip locked` e já marcadas
 * como feitas; falha de execução vira log e não retentativa infinita (ver
 * `claimDueActions`).
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
    try {
      switch (kind) {
        case 'unban':
        case 'untimeout':
          await this.undoPunishment(action, kind, payload);
          break;
        case 'unlock':
          await this.unlockChannel(action, payload);
          break;
        case 'reminder':
          await this.deliverReminder(action, payload);
          break;
        case 'poll_close':
          await this.closePoll(action, payload);
          break;
        case 'autorole':
          await this.applyAutorole(action, payload);
          break;
      }
    } catch (error) {
      log.error({ err: error, actionId: action.id, kind }, 'falha ao executar ação');
    }
  }

  private async undoPunishment(
    action: ScheduledAction,
    kind: UndoKind,
    payload: ActionPayload,
  ): Promise<void> {
    const targetId = payload.targetId;
    if (!targetId) {
      log.warn({ actionId: action.id, kind }, 'ação agendada sem targetId');
      return;
    }

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
      actorTag: bot?.tag ?? 'Goodbot',
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
  }

  /** `/lock` com duração: devolve os overwrites originais na hora marcada. */
  private async unlockChannel(action: ScheduledAction, payload: ActionPayload): Promise<void> {
    const channelId = payload.channelId;
    if (!channelId) {
      log.warn({ actionId: action.id }, 'unlock agendado sem channelId');
      return;
    }
    const guild = await this.deps.client.guilds.fetch(action.guildId);
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!isLockable(channel)) {
      log.debug({ actionId: action.id, channelId }, 'canal do unlock não existe mais');
      return;
    }

    const outcome = await this.deps.locks.unlock({
      guildId: action.guildId,
      channel,
      reason: AUTO_UNLOCK_REASON,
    });
    // Um `/unlock` manual antes da hora já resolveu: nada a anunciar.
    if (outcome === 'not-locked') return;

    const [config, settings] = await Promise.all([
      this.deps.config.get(action.guildId, 'utilities'),
      this.deps.config.getSettings(action.guildId),
    ]);
    await announceLock(channel, {
      locked: false,
      reason: AUTO_UNLOCK_REASON,
      embedColor: settings.embedColor,
      announce: config.lock.announceInChannel,
    });
    await this.deps.modlog.postAction(action.guildId, {
      embeds: [
        logEmbed({
          title: 'Canal destrancado',
          tone: 'create',
          description: `<#${channelId}> — o lock temporário expirou.`,
          footer: `CANAL: ${channelId}`,
        }),
      ],
    });
    log.info({ actionId: action.id, channelId }, 'canal destrancado automaticamente');
  }

  private async deliverReminder(action: ScheduledAction, payload: ActionPayload): Promise<void> {
    const reminderId = payload.reminderId;
    if (reminderId === undefined) {
      log.warn({ actionId: action.id }, 'reminder agendado sem reminderId');
      return;
    }
    const pending = await getReminder(this.deps.db, reminderId);
    // Cancelado pelo dono (ou já entregue): não manda nada.
    if (!pending || pending.doneAt) return;

    const settings = await this.deps.config.getSettings(action.guildId);
    const embed = infoEmbed(
      {
        title: 'Lembrete',
        description: pending.text,
        fields: [
          { name: 'Criado em', value: code(pending.createdAt.toISOString()), inline: false },
        ],
        footer: botFooter(`ID: ${pending.id}`),
      },
      settings.embedColor,
    );

    let delivered = false;
    if (pending.channelId) {
      const channel = await this.deps.client.channels.fetch(pending.channelId).catch(() => null);
      if (channel?.isTextBased() && 'send' in channel) {
        await channel.send({ content: `<@${pending.userId}>`, embeds: [embed] });
        delivered = true;
      }
    }
    if (!delivered) {
      // Sem canal (ou canal sumiu): cai na DM, que é o padrão do `/remind`.
      const user = await this.deps.client.users.fetch(pending.userId).catch(() => null);
      await user?.send({ embeds: [embed] }).catch(() => null);
    }

    await completeReminder(this.deps.db, pending.id);
    log.info({ actionId: action.id, reminderId: pending.id }, 'lembrete entregue');
  }

  /** Autorole com atraso maior que um `setTimeout` aguenta atravessar. */
  private async applyAutorole(action: ScheduledAction, payload: ActionPayload): Promise<void> {
    const targetId = payload.targetId;
    if (!targetId) {
      log.warn({ actionId: action.id }, 'autorole agendado sem targetId');
      return;
    }
    const guild = await this.deps.client.guilds.fetch(action.guildId);
    await this.deps.autorole.applyFor(guild, targetId);
  }

  private async closePoll(action: ScheduledAction, payload: ActionPayload): Promise<void> {
    const pollId = payload.pollId;
    if (!pollId) {
      log.warn({ actionId: action.id }, 'poll_close agendado sem pollId');
      return;
    }
    const closed = await this.deps.polls.close(pollId);
    if (closed) log.info({ actionId: action.id, pollId }, 'enquete encerrada');
  }
}
