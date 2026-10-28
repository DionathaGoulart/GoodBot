import {
  claimDueActions,
  completeReminder,
  completeScheduledAction,
  createCase,
  failScheduledAction,
  getReminder,
  isScheduledActionActive,
  listStalePendingChannelLocks,
  markReminderSendAttempt,
  markScheduledUndoAttempting,
  markStaleScheduledUndos,
  markStalePunishmentTransitions,
  markStaleReminderDeliveries,
  withPunishmentLock,
} from '@goodbot/db';
import { DEFAULT_REASON, SECOND_MS } from '@goodbot/shared';
import { DiscordAPIError } from 'discord.js';

import { botFooter, code, infoEmbed } from '../lib/embeds';
import { logEmbed } from '../lib/log-embeds';
import { childLogger } from '../logger';
import { UnconfirmedChannelLockError, announceLock, isLockable } from './locks';

import type { AlertService } from './alerts';
import type { AutoroleService } from './autorole';
import type { ConfigService } from './config';
import type { LockService } from './locks';
import type { ModlogService } from './modlog';
import type { PollService } from './polls';
import type { Db, ScheduledAction } from '@goodbot/db';
import type { CaseType } from '@goodbot/shared';
import type { Client } from 'discord.js';

const log = childLogger('scheduler');

class ReminderDeliveryUncertainError extends Error {}
class ReminderClaimLostError extends Error {}
class PunishmentUndoUncertainError extends Error {}

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
  lockId?: number;
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
  alerts?: Pick<AlertService, 'emit'>;
  /** Sobrescreve o intervalo (testes e dev). */
  intervalMs?: number;
  /** Quantas ações uma passada processa. */
  batchSize?: number;
}

/**
 * Executa o que foi agendado: desfazer punições temporárias, destrancar
 * canais, entregar lembretes, encerrar enquetes e aplicar o autorole atrasado.
 * Cada ação recebe um lease recuperável; só é concluída após o efeito. Falhas
 * transitórias têm espera progressiva, com limite e estado terminal visível.
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
    let processed = 0;
    try {
      const stale = await markStalePunishmentTransitions(this.deps.db);
      for (const marker of stale) {
        log.error(
          { markerId: marker.id, guildId: marker.guildId, payload: marker.payload },
          'punição preparada sem confirmação; reconciliação manual necessária',
        );
        this.deps.alerts?.emit({
          kind: `moderation-stale:${marker.id}`,
          title: 'Punição preparada sem confirmação',
          level: 'danger',
          description:
            'Confira o estado no Discord e reconcilie o caso e a tarefa agendada no banco. O bot não fará o desfazimento automaticamente.',
          fields: [
            { name: 'Servidor', value: marker.guildId },
            { name: 'Alvo', value: String(marker.payload.targetId ?? 'desconhecido') },
            { name: 'Marcador', value: String(marker.id) },
          ],
        });
      }
      const uncertainReminders = await markStaleReminderDeliveries(this.deps.db);
      for (const reminder of uncertainReminders) {
        log.error(
          { actionId: reminder.id, guildId: reminder.guildId, payload: reminder.payload },
          'lembrete com entrega incerta; reenvio automático suspenso',
        );
        this.deps.alerts?.emit({
          kind: `reminder-uncertain:${reminder.id}`,
          title: 'Entrega de lembrete incerta',
          level: 'warning',
          description:
            'Verifique o histórico do canal ou DM antes de reenviar. O bot suspendeu o reenvio para evitar mensagem duplicada.',
          fields: [
            { name: 'Servidor', value: reminder.guildId },
            { name: 'Ação', value: String(reminder.id) },
            { name: 'Lembrete', value: String(reminder.payload.reminderId ?? 'desconhecido') },
          ],
        });
      }
      const uncertainUndos = await markStaleScheduledUndos(this.deps.db);
      for (const undo of uncertainUndos) {
        this.deps.alerts?.emit({
          kind: `punishment-undo-uncertain:${undo.id}`,
          title: 'Reversão de punição pendente de conferência',
          level: 'danger',
          description:
            'O processo caiu após registrar início da chamada ao Discord. Confira o estado do alvo antes de reexecutar.',
          fields: [
            { name: 'Servidor', value: undo.guildId },
            { name: 'Ação', value: String(undo.id) },
            { name: 'Alvo', value: String(undo.payload.targetId ?? 'desconhecido') },
          ],
        });
      }
      const pendingLocks = await listStalePendingChannelLocks(
        this.deps.db,
        new Date(Date.now() - 10 * 60_000),
      );
      for (const lock of pendingLocks) {
        log.error(
          { guildId: lock.guildId, channelId: lock.channelId, lockId: lock.id },
          'lock reservado sem confirmação no Discord',
        );
        this.deps.alerts?.emit({
          kind: `lock-pending:${lock.id}`,
          title: 'Lock pendente de reconciliação',
          level: 'danger',
          description:
            'Verifique os overwrites no Discord. O unlock automático foi bloqueado; use unlock manual após confirmar o estado.',
          fields: [
            { name: 'Servidor', value: lock.guildId },
            { name: 'Canal', value: lock.channelId },
            { name: 'Lock', value: String(lock.id) },
          ],
        });
      }
      // Reservar de uma em uma impede que a última ação de um lote lento
      // perca seu lease antes de começar a execução.
      for (let i = 0; i < (this.deps.batchSize ?? 25); i++) {
        const [action] = await claimDueActions(this.deps.db, {
          kinds: HANDLED_KINDS,
          limit: 1,
        });
        if (!action) break;
        await this.run(action);
        processed++;
      }
      return processed;
    } catch (error) {
      log.error({ err: error }, 'falha na passada do scheduler');
      return processed;
    } finally {
      this.running = false;
    }
  }

  private async run(action: ScheduledAction): Promise<void> {
    const kind = action.kind as HandledKind;
    const payload = action.payload as ActionPayload;
    try {
      if (!action.claimToken) throw new Error('Ação sem token de reserva');
      switch (kind) {
        case 'unban':
        case 'untimeout':
          await this.undoPunishment(action, kind, payload);
          return;
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
      await completeScheduledAction(this.deps.db, action.id, action.claimToken);
    } catch (error) {
      if (error instanceof ReminderDeliveryUncertainError) {
        this.deps.alerts?.emit({
          kind: `reminder-uncertain:${action.id}`,
          title: 'Lembrete com entrega incerta',
          level: 'danger',
          description:
            'A janela de deduplicação expirou. Verifique o destino no Discord antes de reenviar.',
          fields: [
            { name: 'Servidor', value: action.guildId },
            { name: 'Ação', value: String(action.id) },
          ],
        });
      }
      if (error instanceof PunishmentUndoUncertainError) {
        this.deps.alerts?.emit({
          kind: `punishment-undo-uncertain:${action.id}`,
          title: 'Reversão de punição requer conferência',
          level: 'danger',
          description:
            'O Discord pode ter aceitado a reversão, mas a confirmação ou o caso falhou. Confira Discord e banco antes de repetir.',
          fields: [
            { name: 'Servidor', value: action.guildId },
            { name: 'Ação', value: String(action.id) },
            { name: 'Alvo', value: String(action.payload.targetId ?? 'desconhecido') },
          ],
        });
      }
      const outcome = action.claimToken
        ? await failScheduledAction(this.deps.db, {
            id: action.id,
            claimToken: action.claimToken,
            attempts:
              error instanceof UnconfirmedChannelLockError ||
              error instanceof PunishmentUndoUncertainError
                ? 8
                : action.attempts,
            error: error instanceof Error ? error.message : 'Erro desconhecido',
          })
        : 'terminal';
      log.error(
        { err: error, actionId: action.id, kind, attempts: action.attempts, outcome },
        'falha ao executar ação agendada',
      );
      if (outcome === 'terminal') {
        this.deps.alerts?.emit({
          kind: `scheduled-action-terminal:${action.id}`,
          title: 'Ação agendada requer intervenção',
          level: 'danger',
          description:
            error instanceof UnconfirmedChannelLockError
              ? 'Lock sem confirmação de aplicação. Verifique os overwrites e o snapshot antes de restaurar manualmente.'
              : 'Tentativas esgotadas. Verifique o estado no Discord e no banco antes de repetir.',
          fields: [
            { name: 'Servidor', value: action.guildId },
            { name: 'Ação', value: String(action.id) },
            { name: 'Tipo', value: kind },
            ...(error instanceof UnconfirmedChannelLockError
              ? [
                  { name: 'Canal', value: error.channelId },
                  { name: 'Lock', value: String(error.lockId) },
                ]
              : []),
          ],
        });
      }
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
      if (action.claimToken)
        await completeScheduledAction(this.deps.db, action.id, action.claimToken);
      return;
    }

    const reason = REASON_BY_KIND[kind];
    // Falhas de leitura acontecem antes do marcador e continuam recuperáveis.
    const preflightGuild = await this.deps.client.guilds.fetch(action.guildId);
    try {
      if (kind === 'unban') await preflightGuild.bans.fetch(targetId);
      else await preflightGuild.members.fetch({ user: targetId, force: true });
    } catch (error) {
      if (!isUnknownDiscordResource(error, kind === 'unban' ? 10026 : 10007)) throw error;
    }
    // Commit separado antes do REST: uma queda não reivindica a reversão outra vez.
    if (
      !action.claimToken ||
      !(await withPunishmentLock(this.deps.db, action.guildId, kind, targetId, (tx) =>
        markScheduledUndoAttempting(tx, action.id, action.claimToken!),
      ))
    )
      return;
    let effectStarted = false;
    let targetTag: string | null;
    try {
      targetTag = await withPunishmentLock(
        this.deps.db,
        action.guildId,
        kind,
        targetId,
        async (tx) => {
          // Mesmo que a tarefa tenha sido reservada antes de uma renovação, o
          // novo caso pode tê-la cancelado enquanto esperava este advisory lock.
          if (
            !action.claimToken ||
            !(await isScheduledActionActive(tx, action.id, action.claimToken))
          ) {
            return null;
          }

          const guild = await this.deps.client.guilds.fetch(action.guildId);
          if (kind === 'unban') {
            let ban;
            try {
              ban = await guild.bans.fetch(targetId);
            } catch (error) {
              if (isUnknownDiscordResource(error, 10026)) {
                await completeScheduledAction(tx, action.id, action.claimToken!);
                return null;
              }
              throw error;
            }
            effectStarted = true;
            await guild.bans.remove(targetId, reason);
            if (!(await completeScheduledAction(tx, action.id, action.claimToken!)))
              throw new Error('Reversão sem confirmação da tarefa');
            return ban.user.tag;
          }

          let member;
          try {
            member = await guild.members.fetch({ user: targetId, force: true });
          } catch (error) {
            if (isUnknownDiscordResource(error, 10007)) {
              await completeScheduledAction(tx, action.id, action.claimToken!);
              return null;
            }
            throw error;
          }
          // Timeout renovado externamente: nunca desfazer o prazo mais recente.
          if (
            member.communicationDisabledUntil &&
            member.communicationDisabledUntil.getTime() > action.runAt.getTime() + 2_000
          ) {
            await completeScheduledAction(tx, action.id, action.claimToken!);
            return null;
          }
          // O Discord pode já ter expirado o timeout nativo.
          if (member.communicationDisabledUntil) {
            effectStarted = true;
            await member.timeout(null, reason);
          }
          if (!(await completeScheduledAction(tx, action.id, action.claimToken!)))
            throw new Error('Reversão sem confirmação da tarefa');
          return member.user.tag;
        },
      );
    } catch (error) {
      throw new PunishmentUndoUncertainError(
        effectStarted
          ? 'Reversão Discord sem confirmação no banco'
          : 'Reversão iniciada sem confirmação do resultado',
        { cause: error },
      );
    }
    if (targetTag === null) return;

    const bot = this.deps.client.user;
    let kase;
    try {
      kase = await createCase(this.deps.db, {
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
    } catch (error) {
      throw new PunishmentUndoUncertainError('Reversão concluída; caso ou modlog pendente', {
        cause: error,
      });
    }

    log.info(
      { actionId: action.id, kind, targetId, caseNumber: kase.caseNumber },
      'ação agendada executada',
    );
  }

  /** `/lock` com duração: devolve os overwrites originais na hora marcada. */
  private async unlockChannel(action: ScheduledAction, payload: ActionPayload): Promise<void> {
    const { channelId, lockId } = payload;
    if (!channelId || !Number.isSafeInteger(lockId)) {
      log.warn({ actionId: action.id }, 'unlock agendado sem identidade do lock');
      return;
    }
    const guild = await this.deps.client.guilds.fetch(action.guildId);
    let channel;
    try {
      channel = await guild.channels.fetch(channelId);
    } catch (error) {
      if (isUnknownDiscordResource(error, 10003)) return;
      throw error;
    }
    if (!isLockable(channel)) {
      log.debug({ actionId: action.id, channelId }, 'canal do unlock não existe mais');
      return;
    }

    const outcome = await this.deps.locks.unlock({
      guildId: action.guildId,
      channel,
      reason: AUTO_UNLOCK_REASON,
      expectedLockId: lockId,
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
    // Uma ação reclamada novamente após crash usa o mesmo nonce. O Discord
    // deduplica dentro de uma janela curta; a fila usa lease de 90s aqui.
    const nonce = `r:${pending.id}`;
    const reserveSend = async () => {
      if (!action.claimToken) throw new ReminderClaimLostError('Reserva do lembrete perdida');
      const result = await markReminderSendAttempt(this.deps.db, action.id, action.claimToken);
      if (result === 'uncertain')
        throw new ReminderDeliveryUncertainError('Entrega do lembrete incerta');
      if (result === 'superseded') throw new ReminderClaimLostError('Reserva do lembrete perdida');
    };

    let delivered = false;
    if (pending.channelId) {
      let channel;
      try {
        channel = await this.deps.client.channels.fetch(pending.channelId);
      } catch (error) {
        if (!isUnknownDiscordResource(error, 10003)) throw error;
        channel = null;
      }
      if (channel?.isTextBased() && 'send' in channel) {
        await reserveSend();
        await channel.send({
          content: `<@${pending.userId}>`,
          embeds: [embed],
          nonce,
          enforceNonce: true,
        });
        delivered = true;
      }
    }
    if (!delivered) {
      // Sem canal (ou canal sumiu): cai na DM, que é o padrão do `/remind`.
      const user = await this.deps.client.users.fetch(pending.userId);
      await reserveSend();
      await user.send({ embeds: [embed], nonce, enforceNonce: true });
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

function isUnknownDiscordResource(error: unknown, code: number): boolean {
  return error instanceof DiscordAPIError && error.code === code;
}
