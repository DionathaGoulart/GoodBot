import { deleteChannelLock, getChannelLock, listChannelLocks, saveChannelLock } from '@cobot/db';
import { OverwriteType, PermissionFlagsBits } from 'discord.js';

import { botFooter, infoEmbed, warningEmbed } from '../lib/embeds';

import type { ChannelLock, Db, LockOverwrite } from '@cobot/db';
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

/** Snapshot dos overwrites atuais dos ids afetados (só eles). */
function snapshot(channel: LockableChannel, ids: readonly string[]): LockOverwrite[] {
  const kept: LockOverwrite[] = [];
  for (const id of ids) {
    const overwrite = channel.permissionOverwrites.cache.get(id);
    if (!overwrite) continue;
    kept.push({
      id,
      type: overwrite.type,
      allow: overwrite.allow.bitfield.toString(),
      deny: overwrite.deny.bitfield.toString(),
    });
  }
  return kept;
}

/**
 * Overwrite com `id` já estreitado para `string`. O `OverwriteData` do
 * discord.js aceita `Role`/`User` no `id`, o que impediria indexar por id.
 */
interface ExactOverwrite {
  id: string;
  type: OverwriteType;
  allow: bigint;
  deny: bigint;
}

/** Lista completa atual, para poder reescrevê-la com um único `set`. */
function currentOverwrites(channel: LockableChannel): ExactOverwrite[] {
  return channel.permissionOverwrites.cache.map((overwrite) => ({
    id: overwrite.id,
    type: overwrite.type,
    allow: overwrite.allow.bitfield,
    deny: overwrite.deny.bitfield,
  }));
}

export interface LockInput {
  guildId: string;
  channel: LockableChannel;
  /** `@everyone` mais os cargos de `utilities.lock.extraRoleIds`. */
  roleIds: readonly string[];
  actorId: string;
  reason: string;
}

export type LockOutcome = 'locked' | 'already-locked';
export type UnlockOutcome = 'unlocked' | 'not-locked';

/**
 * Lock e unlock de canais com restauração exata. O snapshot dos overwrites
 * anteriores vive em `channel_locks`; sem ele o unlock devolveria
 * `SendMessages` a quem nunca teve a permissão.
 */
export class LockService {
  constructor(private readonly db: Db) {}

  async isLocked(guildId: string, channelId: string): Promise<boolean> {
    return (await getChannelLock(this.db, guildId, channelId)) !== null;
  }

  async list(guildId: string): Promise<ChannelLock[]> {
    return listChannelLocks(this.db, guildId);
  }

  async lock(input: LockInput): Promise<LockOutcome> {
    const { channel, roleIds } = input;
    // O insert só passa se ainda não havia lock: um segundo `/lock` não pode
    // sobrescrever o snapshot com os overwrites já trancados.
    const saved = await saveChannelLock(this.db, {
      guildId: input.guildId,
      channelId: channel.id,
      roleIds: [...roleIds],
      overwrites: snapshot(channel, roleIds),
      lockedBy: input.actorId,
      reason: input.reason,
    });
    if (!saved) return 'already-locked';

    const next = currentOverwrites(channel);
    for (const roleId of roleIds) {
      const existing = next.find((overwrite) => overwrite.id === roleId);
      if (existing) {
        existing.allow &= ~LOCK_PERMISSIONS;
        existing.deny |= LOCK_PERMISSIONS;
      } else {
        next.push({ id: roleId, type: OverwriteType.Role, allow: 0n, deny: LOCK_PERMISSIONS });
      }
    }

    try {
      await channel.permissionOverwrites.set(next, input.reason);
    } catch (error) {
      // Sem overwrite aplicado não há lock: some com a linha para o próximo
      // `/lock` poder tentar de novo com o snapshot certo.
      await deleteChannelLock(this.db, input.guildId, channel.id);
      throw error;
    }
    return 'locked';
  }

  async unlock(input: {
    guildId: string;
    channel: LockableChannel;
    reason: string;
  }): Promise<UnlockOutcome> {
    const lock = await deleteChannelLock(this.db, input.guildId, input.channel.id);
    if (!lock) return 'not-locked';

    const affected = new Set(lock.roleIds);
    const previous = new Map(lock.overwrites.map((overwrite) => [overwrite.id, overwrite]));
    const next: ExactOverwrite[] = [];
    for (const overwrite of currentOverwrites(input.channel)) {
      // Id que o lock não tocou: fica exatamente como está.
      if (!affected.has(overwrite.id)) {
        next.push(overwrite);
        continue;
      }
      const saved = previous.get(overwrite.id);
      // Sem snapshot o id não tinha overwrite antes do lock — omiti-lo aqui é
      // o que apaga o overwrite que o próprio lock criou.
      if (!saved) continue;
      next.push({
        id: saved.id,
        type: saved.type as OverwriteType,
        allow: BigInt(saved.allow),
        deny: BigInt(saved.deny),
      });
    }

    await input.channel.permissionOverwrites.set(next, input.reason);
    return 'unlocked';
  }
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
