import { Collection, DiscordAPIError, OverwriteType, PermissionFlagsBits } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LockableChannel } from './locks';
import type { ChannelLock } from '@goodbot/db';

const {
  saveChannelLock,
  deleteChannelLock,
  getChannelLock,
  listChannelLocks,
  withChannelLock,
  scheduleAction,
  cancelScheduledChannelUnlocks,
  markChannelLockApplied,
} = vi.hoisted(() => ({
  saveChannelLock: vi.fn(),
  deleteChannelLock: vi.fn(),
  getChannelLock: vi.fn(),
  listChannelLocks: vi.fn(),
  withChannelLock: vi.fn(),
  scheduleAction: vi.fn(),
  cancelScheduledChannelUnlocks: vi.fn(),
  markChannelLockApplied: vi.fn(),
}));

vi.mock('@goodbot/db', () => ({
  saveChannelLock,
  deleteChannelLock,
  getChannelLock,
  listChannelLocks,
  withChannelLock,
  scheduleAction,
  cancelScheduledChannelUnlocks,
  markChannelLockApplied,
}));

const { LOCK_PERMISSIONS, LockService } = await import('./locks');

const GUILD_ID = '900000000000000000';
const EVERYONE = GUILD_ID;
const EXTRA_ROLE = '700000000000000001';
const MEMBER = '300000000000000000';

function discordRejection(status: number): DiscordAPIError {
  return Object.assign(Object.create(DiscordAPIError.prototype), {
    status,
    code: 50013,
    message: 'Discord recusou o lock',
  }) as DiscordAPIError;
}

interface RawOverwrite {
  id: string;
  type: OverwriteType;
  allow: bigint;
  deny: bigint;
}

/** Canal com o cache de overwrites que o `LockService` lê e o `set` que ele escreve. */
function fakeChannel(initial: RawOverwrite[]) {
  const toCache = (list: readonly RawOverwrite[]) =>
    new Collection(
      list.map((overwrite) => [
        overwrite.id,
        {
          id: overwrite.id,
          type: overwrite.type,
          allow: { bitfield: overwrite.allow },
          deny: { bitfield: overwrite.deny },
        },
      ]),
    );
  const manager = {
    cache: toCache(initial),
    set: vi.fn((list: RawOverwrite[]) => {
      manager.cache = toCache(list);
      return Promise.resolve();
    }),
  };
  return {
    id: '800000000000000000',
    permissionOverwrites: manager,
  } as unknown as LockableChannel & {
    permissionOverwrites: typeof manager;
  };
}

describe('LockService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withChannelLock.mockImplementation(
      (db: unknown, _guild: string, _channel: string, action: (tx: unknown) => Promise<unknown>) =>
        action(db),
    );
    cancelScheduledChannelUnlocks.mockResolvedValue(0);
    markChannelLockApplied.mockResolvedValue(undefined);
    getChannelLock.mockResolvedValue({ id: 1 } as ChannelLock);
  });

  it('nega envio preservando os outros bits e cria overwrite para cargo sem um', async () => {
    const channel = fakeChannel([
      {
        id: EVERYONE,
        type: OverwriteType.Role,
        allow: PermissionFlagsBits.SendMessages | PermissionFlagsBits.AddReactions,
        deny: PermissionFlagsBits.AttachFiles,
      },
      { id: MEMBER, type: OverwriteType.Member, allow: PermissionFlagsBits.SendMessages, deny: 0n },
    ]);
    saveChannelLock.mockImplementation((_db, input: Record<string, unknown>) =>
      Promise.resolve({ id: 1, ...input }),
    );

    const service = new LockService({} as never);
    const outcome = await service.lock({
      guildId: GUILD_ID,
      channel,
      roleIds: [EVERYONE, EXTRA_ROLE],
      actorId: MEMBER,
      reason: 'teste',
    });

    expect(outcome).toBe('locked');
    expect(markChannelLockApplied).toHaveBeenCalledWith({}, 1);
    // O snapshot guarda só quem tinha overwrite entre os ids afetados.
    expect(saveChannelLock.mock.calls[0]?.[1]).toMatchObject({
      overwrites: [
        {
          id: EVERYONE,
          type: OverwriteType.Role,
          allow: (PermissionFlagsBits.SendMessages | PermissionFlagsBits.AddReactions).toString(),
          deny: PermissionFlagsBits.AttachFiles.toString(),
        },
      ],
    });
    expect(channel.permissionOverwrites.set).toHaveBeenCalledWith(
      [
        {
          id: EVERYONE,
          type: OverwriteType.Role,
          allow: PermissionFlagsBits.AddReactions,
          deny: PermissionFlagsBits.AttachFiles | LOCK_PERMISSIONS,
        },
        {
          id: MEMBER,
          type: OverwriteType.Member,
          allow: PermissionFlagsBits.SendMessages,
          deny: 0n,
        },
        { id: EXTRA_ROLE, type: OverwriteType.Role, allow: 0n, deny: LOCK_PERMISSIONS },
      ],
      'teste',
    );
  });

  it('não sobrescreve o snapshot quando o canal já estava trancado', async () => {
    const channel = fakeChannel([]);
    saveChannelLock.mockResolvedValue(null);

    const outcome = await new LockService({} as never).lock({
      guildId: GUILD_ID,
      channel,
      roleIds: [EVERYONE],
      actorId: MEMBER,
      reason: 'teste',
    });

    expect(outcome).toBe('already-locked');
    expect(channel.permissionOverwrites.set).not.toHaveBeenCalled();
  });

  it('preserva o snapshot quando o REST falha após a reserva', async () => {
    const channel = fakeChannel([]);
    saveChannelLock.mockResolvedValue({ id: 1 });
    channel.permissionOverwrites.set.mockRejectedValueOnce(new Error('50013'));

    await expect(
      new LockService({} as never).lock({
        guildId: GUILD_ID,
        channel,
        roleIds: [EVERYONE],
        actorId: MEMBER,
        reason: 'teste',
      }),
    ).rejects.toThrow('50013');
    expect(deleteChannelLock).not.toHaveBeenCalled();
    expect(saveChannelLock).toHaveBeenCalledOnce();
    expect(getChannelLock).toHaveBeenCalledWith({}, GUILD_ID, channel.id);
  });

  it('rejeição definitiva remove snapshot e unlock reservado', async () => {
    const channel = fakeChannel([]);
    saveChannelLock.mockResolvedValue({ id: 1 });
    deleteChannelLock.mockResolvedValue({ id: 1 });
    channel.permissionOverwrites.set.mockRejectedValueOnce(discordRejection(403));

    await expect(
      new LockService({} as never).lock({
        guildId: GUILD_ID,
        channel,
        roleIds: [EVERYONE],
        actorId: MEMBER,
        reason: 'teste',
        durationMs: 60_000,
      }),
    ).rejects.toThrow('Discord recusou o lock');
    expect(deleteChannelLock).toHaveBeenCalledWith({}, GUILD_ID, channel.id, 1);
    expect(cancelScheduledChannelUnlocks).toHaveBeenCalledWith({}, GUILD_ID, channel.id, 1);
  });

  it('falha ao confirmar lock após REST preserva snapshot e emite alerta', async () => {
    const channel = fakeChannel([]);
    saveChannelLock.mockResolvedValue({ id: 1 });
    markChannelLockApplied.mockRejectedValueOnce(new Error('commit falhou'));
    const alerts = { emit: vi.fn() };
    await expect(
      new LockService({} as never, alerts).lock({
        guildId: GUILD_ID,
        channel,
        roleIds: [EVERYONE],
        actorId: MEMBER,
        reason: 'teste',
      }),
    ).rejects.toThrow('commit falhou');
    expect(deleteChannelLock).not.toHaveBeenCalled();
    expect(alerts.emit).toHaveBeenCalledWith(expect.objectContaining({ level: 'danger' }));
  });

  it('unlock pendente exige confirmação explícita após checar permissões', async () => {
    const channel = fakeChannel([]);
    const lock = {
      id: 1,
      roleIds: [EVERYONE],
      overwrites: [],
      appliedAt: null,
    } as unknown as ChannelLock;
    getChannelLock.mockResolvedValue(lock);
    deleteChannelLock.mockResolvedValue(lock);
    const service = new LockService({} as never);
    await expect(
      service.unlock({ guildId: GUILD_ID, channel, reason: 'expirou', expectedLockId: 1 }),
    ).rejects.toThrow('Lock sem confirmação');
    await expect(service.unlock({ guildId: GUILD_ID, channel, reason: 'manual' })).rejects.toThrow(
      'Lock sem confirmação',
    );
    expect(channel.permissionOverwrites.set).not.toHaveBeenCalled();
    expect(
      await service.unlock({ guildId: GUILD_ID, channel, reason: 'manual', confirmPending: true }),
    ).toBe('unlocked');
    expect(channel.permissionOverwrites.set).toHaveBeenCalledOnce();
  });

  it('confirma a reserva antes de aplicar os overwrites', async () => {
    const channel = fakeChannel([]);
    const order: string[] = [];
    withChannelLock.mockImplementation(
      async (
        db: unknown,
        _guild: string,
        _channel: string,
        action: (tx: unknown) => Promise<unknown>,
      ) => {
        const result = await action(db);
        order.push('commit');
        return result;
      },
    );
    saveChannelLock.mockImplementation(() => {
      order.push('snapshot');
      return Promise.resolve({ id: 1 } as ChannelLock);
    });
    scheduleAction.mockImplementation(() => {
      order.push('schedule');
      return Promise.resolve();
    });
    channel.permissionOverwrites.set.mockImplementation(() => {
      order.push('discord');
      return Promise.resolve();
    });

    await new LockService({} as never).lock({
      guildId: GUILD_ID,
      channel,
      roleIds: [EVERYONE],
      actorId: MEMBER,
      reason: 'teste',
      durationMs: 60_000,
    });
    expect(order).toEqual(['snapshot', 'schedule', 'commit', 'discord', 'commit']);
  });

  it('não aplica lock cancelado entre a reserva e o REST', async () => {
    const channel = fakeChannel([]);
    saveChannelLock.mockResolvedValue({ id: 1 } as ChannelLock);
    getChannelLock.mockResolvedValue(null);

    await expect(
      new LockService({} as never).lock({
        guildId: GUILD_ID,
        channel,
        roleIds: [EVERYONE],
        actorId: MEMBER,
        reason: 'teste',
      }),
    ).rejects.toThrow('Lock encerrado antes de ser aplicado');
    expect(channel.permissionOverwrites.set).not.toHaveBeenCalled();
  });

  it('unlock restaura o estado anterior exato e apaga o overwrite que o lock criou', async () => {
    const before: RawOverwrite[] = [
      {
        id: EVERYONE,
        type: OverwriteType.Role,
        allow: PermissionFlagsBits.SendMessages | PermissionFlagsBits.AddReactions,
        deny: PermissionFlagsBits.AttachFiles,
      },
      { id: MEMBER, type: OverwriteType.Member, allow: PermissionFlagsBits.SendMessages, deny: 0n },
    ];
    const channel = fakeChannel(before);
    let saved: ChannelLock | null = null;
    saveChannelLock.mockImplementation((_db, input: Record<string, unknown>) => {
      saved = { id: 1, ...input } as unknown as ChannelLock;
      return Promise.resolve(saved);
    });
    getChannelLock.mockImplementation(() => Promise.resolve(saved));
    deleteChannelLock.mockImplementation(() => Promise.resolve(saved));

    const service = new LockService({} as never);
    await service.lock({
      guildId: GUILD_ID,
      channel,
      roleIds: [EVERYONE, EXTRA_ROLE],
      actorId: MEMBER,
      reason: 'teste',
    });
    const outcome = await service.unlock({ guildId: GUILD_ID, channel, reason: 'fim' });

    expect(outcome).toBe('unlocked');
    expect(channel.permissionOverwrites.set).toHaveBeenLastCalledWith(before, 'fim');
    expect(deleteChannelLock).toHaveBeenCalledWith({}, GUILD_ID, channel.id, 1);
    expect(cancelScheduledChannelUnlocks).toHaveBeenCalledWith({}, GUILD_ID, channel.id, 1);
  });

  it('unlock sem lock gravado não mexe no canal', async () => {
    const channel = fakeChannel([]);
    getChannelLock.mockResolvedValue(null);

    const outcome = await new LockService({} as never).unlock({
      guildId: GUILD_ID,
      channel,
      reason: 'fim',
    });

    expect(outcome).toBe('not-locked');
    expect(channel.permissionOverwrites.set).not.toHaveBeenCalled();
  });

  it('falha REST mantém o snapshot para que o unlock possa ser repetido', async () => {
    const channel = fakeChannel([]);
    const saved = {
      id: 42,
      guildId: GUILD_ID,
      channelId: channel.id,
      roleIds: [EVERYONE],
      overwrites: [],
    } as unknown as ChannelLock;
    getChannelLock.mockResolvedValue(saved);
    deleteChannelLock.mockResolvedValue(saved);
    channel.permissionOverwrites.set.mockRejectedValueOnce(new Error('falha REST'));
    const service = new LockService({} as never);

    await expect(service.unlock({ guildId: GUILD_ID, channel, reason: 'fim' })).rejects.toThrow(
      'falha REST',
    );
    expect(deleteChannelLock).not.toHaveBeenCalled();
    expect(await service.unlock({ guildId: GUILD_ID, channel, reason: 'fim' })).toBe('unlocked');
    expect(deleteChannelLock).toHaveBeenCalledOnce();
  });

  it('unlock antigo não modifica outra instância do lock', async () => {
    const channel = fakeChannel([]);
    getChannelLock.mockResolvedValue({ id: 43 } as ChannelLock);
    const outcome = await new LockService({} as never).unlock({
      guildId: GUILD_ID,
      channel,
      reason: 'expirou',
      expectedLockId: 42,
    });
    expect(outcome).toBe('not-locked');
    expect(channel.permissionOverwrites.set).not.toHaveBeenCalled();
    expect(deleteChannelLock).not.toHaveBeenCalled();
  });

  it('lock temporário grava tarefa com ID do snapshot', async () => {
    const channel = fakeChannel([]);
    saveChannelLock.mockResolvedValue({ id: 42 } as ChannelLock);
    getChannelLock.mockResolvedValue({ id: 42 } as ChannelLock);
    await new LockService({} as never).lock({
      guildId: GUILD_ID,
      channel,
      roleIds: [EVERYONE],
      actorId: MEMBER,
      reason: 'teste',
      durationMs: 60_000,
    });
    expect(scheduleAction).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        kind: 'unlock',
        payload: { channelId: channel.id, lockId: 42 },
      }),
    );
  });
});
