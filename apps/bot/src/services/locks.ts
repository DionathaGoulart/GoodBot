import {
  cancelScheduledChannelUnlocks,
  deleteChannelLock,
  getChannelLock,
  listChannelLocks,
  markChannelLockApplied,
  saveChannelLock,
  scheduleAction,
  withChannelLock,
} from '@goodbot/db';
import { UserFacingError } from '@goodbot/shared';
import { DiscordAPIError, OverwriteType, PermissionFlagsBits } from 'discord.js';

import { botFooter, infoEmbed, warningEmbed } from '../lib/embeds';
import {
  currentOverwrites,
  denyOverwriteBits,
  restoreOverwrites,
  snapshotOverwrites,
} from '../lib/overwrites';

import type { AlertService } from './alerts';
import type { ChannelLock, Db } from '@goodbot/db';
import type { AnyThreadChannel, GuildBasedChannel } from 'discord.js';

/**
 * O que um lock nega. `SendMessages` é o que o PRD §5.3 exige;
 * `SendMessagesInThreads` vai junto porque um canal trancado onde a conversa
 * continua na thread não está trancado.
 */
export const LOCK_PERMISSIONS =
  PermissionFlagsBits.SendMessages | PermissionFlagsBits.SendMessagesInThreads;

/** Canal com overwrites próprios: qualquer canal da guild que não seja thread. */
export type LockableChannel = Exclude<GuildBasedChannel, AnyThreadChannel>;

export function isLockable(
  channel: GuildBasedChannel | null | undefined,
): channel is LockableChannel {
  return Boolean(channel && !channel.isThread());
}

export interface LockInput {
  guildId: string;
  channel: LockableChannel;
  /** `@everyone` mais os cargos de `utilities.lock.extraRoleIds`. */
  roleIds: readonly string[];
  actorId: string;
  reason: string;
  durationMs?: number;
}

export type LockOutcome = 'locked' | 'already-locked';
export type UnlockOutcome = 'unlocked' | 'not-locked';

export class UnconfirmedChannelLockError extends UserFacingError {
  constructor(
    readonly guildId: string,
    readonly channelId: string,
    readonly lockId: number,
  ) {
    super(
      'Lock sem confirmação. Verifique os overwrites; para restaurar o snapshot antigo use /unlock com confirmar-pendente.',
      { code: 'LOCK_UNCONFIRMED' },
    );
  }
}

/**
 * Lock e unlock de canais com restauração exata. O snapshot dos overwrites
 * anteriores vive em `channel_locks`; sem ele o unlock devolveria
 * `SendMessages` a quem nunca teve a permissão.
 */
export class LockService {
  constructor(
    private readonly db: Db,
    private readonly alerts?: Pick<AlertService, 'emit'>,
  ) {}

  async isLocked(guildId: string, channelId: string): Promise<boolean> {
    return (await getChannelLock(this.db, guildId, channelId)) !== null;
  }

  async list(guildId: string): Promise<ChannelLock[]> {
    return listChannelLocks(this.db, guildId);
  }

  async lock(input: LockInput): Promise<LockOutcome> {
    const { channel, roleIds } = input;
    // Fase 1: o snapshot e o unlock temporário ficam duráveis antes do REST.
    // Uma queda/timeout após o Discord aceitar a chamada não os apaga.
    const saved = await withChannelLock(this.db, input.guildId, channel.id, async (tx) => {
      const saved = await saveChannelLock(tx, {
        guildId: input.guildId,
        channelId: channel.id,
        roleIds: [...roleIds],
        overwrites: snapshotOverwrites(channel, roleIds),
        lockedBy: input.actorId,
        reason: input.reason,
      });
      if (!saved) return null;

      if (input.durationMs) {
        await scheduleAction(tx, {
          guildId: input.guildId,
          kind: 'unlock',
          runAt: new Date(Date.now() + input.durationMs),
          payload: { channelId: channel.id, lockId: saved.id },
        });
      }
      return saved;
    });
    if (!saved) return 'already-locked';

    // Fase 2: unlock concorrente pode ter encerrado a reserva entre as fases.
    // Revalidar o ID sob o mesmo mutex impede aplicar um lock já cancelado.
    let rejected: unknown;
    let attempted = false;
    try {
      const outcome = await withChannelLock<LockOutcome>(
        this.db,
        input.guildId,
        channel.id,
        async (tx) => {
          const current = await getChannelLock(tx, input.guildId, channel.id);
          if (current?.id !== saved.id) {
            throw new Error('Lock encerrado antes de ser aplicado');
          }
          let next = currentOverwrites(channel);
          for (const roleId of roleIds) {
            next = denyOverwriteBits(next, {
              id: roleId,
              type: OverwriteType.Role,
              bits: LOCK_PERMISSIONS,
            });
          }

          try {
            attempted = true;
            await channel.permissionOverwrites.set(next, input.reason);
          } catch (error) {
            // 4xx confirma que nenhum overwrite foi aplicado. Timeout/5xx são
            // ambíguos: o snapshot permanece para reconciliação manual.
            if (isDefinitiveDiscordRejection(error)) {
              await deleteChannelLock(tx, input.guildId, channel.id, saved.id);
              await cancelScheduledChannelUnlocks(tx, input.guildId, channel.id, saved.id);
              rejected = error;
              return 'already-locked';
            }
            throw error;
          }
          await markChannelLockApplied(tx, saved.id);
          return 'locked';
        },
      );
      if (rejected) throw rejected;
      return outcome;
    } catch (error) {
      if (attempted && !rejected) {
        this.alerts?.emit({
          kind: `lock-uncertain:${input.guildId}:${channel.id}:${saved.id}`,
          title: 'Lock com estado incerto',
          level: 'danger',
          description:
            'Verifique os overwrites no Discord e o snapshot no banco antes de restaurar. O unlock automático não restaurará este lock sem confirmação.',
          fields: [
            { name: 'Servidor', value: input.guildId },
            { name: 'Canal', value: channel.id },
            { name: 'Lock', value: String(saved.id) },
          ],
        });
      }
      throw error;
    }
  }

  async unlock(input: {
    guildId: string;
    channel: LockableChannel;
    reason: string;
    /** Unlock agendado só pode atuar sobre a instância que o originou. */
    expectedLockId?: number;
    /** Recuperação explícita após conferir os overwrites no Discord. */
    confirmPending?: boolean;
  }): Promise<UnlockOutcome> {
    return withChannelLock(this.db, input.guildId, input.channel.id, async (tx) => {
      const lock = await getChannelLock(tx, input.guildId, input.channel.id);
      if (!lock || (input.expectedLockId !== undefined && lock.id !== input.expectedLockId)) {
        return 'not-locked';
      }
      if (lock.appliedAt === null && !input.confirmPending) {
        throw new UnconfirmedChannelLockError(input.guildId, input.channel.id, lock.id);
      }

      // Id sem snapshot não tinha overwrite antes do lock: o restore o omite.
      // O snapshot só sai após a restauração confirmada pelo Discord.
      const next = restoreOverwrites(
        currentOverwrites(input.channel),
        lock.roleIds,
        lock.overwrites,
      );
      await input.channel.permissionOverwrites.set(next, input.reason);
      const removed = await deleteChannelLock(tx, input.guildId, input.channel.id, lock.id);
      if (!removed) throw new Error('Lock alterado durante a restauração');
      await cancelScheduledChannelUnlocks(tx, input.guildId, input.channel.id, lock.id);
      return 'unlocked';
    });
  }
}

function isDefinitiveDiscordRejection(error: unknown): boolean {
  return (
    error instanceof DiscordAPIError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  );
}

/**
 * Aviso no próprio canal. Fica aqui (e não no comando) porque o `unlock`
 * agendado precisa exatamente do mesmo aviso.
 */
export async function announceLock(
  channel: LockableChannel,
  input: { locked: boolean; reason: string; embedColor?: number; announce: boolean },
): Promise<void> {
  if (!input.announce || !channel.isTextBased()) return;
  const embed = input.locked
    ? warningEmbed({
        title: 'Canal trancado',
        description: `Este canal foi trancado.\n**Motivo:** ${input.reason}`,
        footer: botFooter('LOCK'),
      })
    : infoEmbed(
        {
          title: 'Canal destrancado',
          description: 'Este canal voltou ao normal.',
          footer: botFooter('LOCK'),
        },
        input.embedColor,
      );
  await channel.send({ embeds: [embed] }).catch(() => null);
}
