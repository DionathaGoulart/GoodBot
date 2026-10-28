import { AuditLogEvent, Collection } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { guildAuditLogEntryCreate, guildMemberUpdate } from './members';

import type { BotContext } from '../../lib/command';
import type { Guild, GuildAuditLogsEntry, GuildMember, PartialGuildMember } from 'discord.js';

function fixture(served = true) {
  const emit = vi.fn();
  const ctx = {
    config: { get: vi.fn().mockResolvedValue({ enabled: true, logAvatarChanges: true }) },
    logs: { emit, getConfigs: vi.fn().mockResolvedValue({ members: { ignoredRoleIds: [] } }) },
    registry: { serves: () => served },
    logger: { warn: vi.fn() },
  } as unknown as BotContext;
  const guild = {
    id: 'guild-member-logs',
    members: { me: { permissions: { has: () => true } }, cache: new Collection() },
  } as unknown as Guild;
  const member = {
    id: 'member',
    guild,
    partial: false,
    nickname: 'Apelido',
    avatar: 'avatar',
    user: { id: 'member', username: 'Pessoa' },
    roles: { cache: new Collection([['helldiver', { id: 'helldiver' }]]) },
  } as unknown as GuildMember;
  return { ctx, emit, guild, member };
}

describe('logs de membros fora do cache', () => {
  it('não inventa cargos, apelido ou avatar a partir de um membro parcial', async () => {
    const { ctx, emit, member } = fixture();
    const previous = {
      ...member,
      partial: true,
      nickname: null,
      avatar: null,
      roles: { cache: new Collection() },
    } as unknown as PartialGuildMember;
    await guildMemberUpdate.execute(ctx, previous, member);
    await guildMemberUpdate.execute(ctx, previous, member);
    expect(emit).not.toHaveBeenCalled();
  });

  it('não registra evento sem mudança nem duplica cargos cobertos pelo audit log', async () => {
    const { ctx, emit, member } = fixture();
    await guildMemberUpdate.execute(ctx, member, member);
    await guildMemberUpdate.execute(
      ctx,
      { ...member, roles: { cache: new Collection() } } as unknown as GuildMember,
      member,
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it('registra delta real e executor mesmo sem membro no cache, uma única vez', async () => {
    const { ctx, emit, guild } = fixture();
    const entry = {
      id: 'audit-real-role-change',
      action: AuditLogEvent.MemberRoleUpdate,
      targetId: 'member',
      executor: { id: 'moderator' },
      reason: 'teste',
      changes: [
        { key: '$add', new: [{ id: 'helldiver', name: 'Helldiver' }] },
        { key: '$remove', new: [{ id: 'old-role', name: 'Antigo' }] },
      ],
    } as unknown as GuildAuditLogsEntry;
    await guildAuditLogEntryCreate.execute(ctx, entry, guild);
    await guildAuditLogEntryCreate.execute(ctx, entry, guild);
    expect(emit).toHaveBeenCalledOnce();
    const text = emit.mock.calls[0]![2].embeds[0].toJSON().description;
    expect(text).toContain('<@moderator>');
    expect(text).toContain('<@&helldiver>');
    expect(text).toContain('<@&old-role>');
  });

  it('ignora audit log de guild não atendida antes de consultar configuração', async () => {
    const { ctx, guild } = fixture(false);
    await guildAuditLogEntryCreate.execute(
      ctx,
      {
        action: AuditLogEvent.MemberRoleUpdate,
        targetId: 'member',
      } as GuildAuditLogsEntry,
      guild,
    );
    expect(ctx.config.get).not.toHaveBeenCalled();
  });

  it('preserva o executor pelo ID quando o usuário não está no cache', async () => {
    const { ctx, emit, guild } = fixture();
    await guildAuditLogEntryCreate.execute(
      ctx,
      {
        id: 'audit-uncached-executor',
        action: AuditLogEvent.MemberRoleUpdate,
        targetId: 'member',
        executor: null,
        executorId: 'moderator',
        changes: [{ key: '$add', new: [{ id: 'helldiver' }] }],
      } as unknown as GuildAuditLogsEntry,
      guild,
    );
    expect(emit.mock.calls[0]![2].embeds[0].toJSON().description).toContain('<@moderator>');
  });
});
