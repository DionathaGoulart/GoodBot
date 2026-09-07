import { bitsToOverride, isEmptyOverride } from '@cobot/shared';
import { OverwriteType } from 'discord.js';

import type {
  AuditLogEntrySummary,
  GuildChannelDetail,
  GuildChannelSummary,
  GuildMemberDetail,
  GuildMemberSummary,
  GuildRoleSummary,
} from '@cobot/shared';
import type {
  GuildBasedChannel,
  GuildMember,
  NonThreadGuildBasedChannel,
  PartialUser,
  Role,
  User,
} from 'discord.js';

/**
 * Só o que lemos de uma entrada do audit log. Estrutural de propósito: os
 * genéricos de `GuildAuditLogsEntry` variam com o tipo da ação e o painel não
 * discrimina nenhum deles.
 */
interface AnyAuditLogEntry {
  id: string;
  action: number;
  targetId: string | null;
  target: unknown;
  executor: User | PartialUser | null;
  reason: string | null;
  createdAt: Date;
  changes: readonly { key: string; old?: unknown; new?: unknown }[];
}

/** Conversores do modelo do discord.js para os schemas de `@cobot/shared`. */

export function toChannelSummary(channel: GuildBasedChannel): GuildChannelSummary {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId,
    position: 'position' in channel ? channel.position : 0,
  };
}

/**
 * O detalhe de um canal, com os overrides de **cargo** traduzidos para o
 * vocabulário do painel (ver/falar). Overrides de membro continuam existindo no
 * Discord; o painel só não os mostra nem os toca (PRD §6.3).
 */
export function toChannelDetail(channel: NonThreadGuildBasedChannel): GuildChannelDetail {
  const overrides = [...channel.permissionOverwrites.cache.values()]
    .filter((overwrite) => overwrite.type === OverwriteType.Role)
    .map((overwrite) =>
      bitsToOverride(overwrite.id, {
        allow: overwrite.allow.bitfield.toString(),
        deny: overwrite.deny.bitfield.toString(),
      }),
    )
    .filter((override) => !isEmptyOverride(override));

  return {
    ...toChannelSummary(channel),
    topic: 'topic' in channel ? (channel.topic ?? null) : null,
    nsfw: 'nsfw' in channel ? channel.nsfw : false,
    slowmodeSeconds: 'rateLimitPerUser' in channel ? (channel.rateLimitPerUser ?? 0) : 0,
    overrides,
  };
}

export function toRoleSummary(role: Role): GuildRoleSummary {
  return {
    id: role.id,
    name: role.name,
    color: role.color,
    position: role.position,
    managed: role.managed,
    hoist: role.hoist,
    mentionable: role.mentionable,
    permissions: role.permissions.bitfield.toString(),
    memberCount: role.members.size,
  };
}

export function toMemberSummary(member: GuildMember): GuildMemberSummary {
  return {
    id: member.id,
    username: member.user.username,
    displayName: member.displayName,
    avatarUrl: member.displayAvatarURL({ size: 128 }),
    bot: member.user.bot,
    joinedAt: member.joinedAt?.toISOString() ?? null,
    roleIds: [...member.roles.cache.keys()],
  };
}

export function toMemberDetail(member: GuildMember): GuildMemberDetail {
  return {
    ...toMemberSummary(member),
    createdAt: member.user.createdAt.toISOString(),
    communicationDisabledUntil: member.communicationDisabledUntil?.toISOString() ?? null,
    highestRolePosition: member.roles.highest.position,
    pending: member.pending,
  };
}

/** Valores do audit log viram texto: o painel só os exibe. */
function changeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function toAuditLogEntry(entry: AnyAuditLogEntry): AuditLogEntrySummary {
  return {
    id: entry.id,
    actionType: entry.action,
    targetId:
      entry.targetId ??
      (entry.target && typeof entry.target === 'object' && 'id' in entry.target
        ? String(entry.target.id)
        : null),
    executor: entry.executor
      ? {
          id: entry.executor.id,
          // Executor parcial (fora do cache) não tem username; o ID serve.
          username: entry.executor.username ?? entry.executor.id,
          avatarUrl: entry.executor.displayAvatarURL({ size: 128 }),
        }
      : null,
    reason: entry.reason,
    createdAt: entry.createdAt.toISOString(),
    changes: entry.changes.map((change) => ({
      key: change.key,
      old: changeValue(change.old),
      new: changeValue(change.new),
    })),
  };
}
