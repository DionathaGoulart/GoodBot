import { Collection, OverwriteType, PermissionFlagsBits } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LockableChannel } from './locks';
import type { ChannelLock } from '@goodbot/db';

const { saveChannelLock, deleteChannelLock, getChannelLock, listChannelLocks } = vi.hoisted(() => ({
  saveChannelLock: vi.fn(),
  deleteChannelLock: vi.fn(),
  getChannelLock: vi.fn(),
  listChannelLocks: vi.fn(),
}));

vi.mock('@goodbot/db', () => ({
  saveChannelLock,
  deleteChannelLock,
  getChannelLock,
  listChannelLocks,
}));

const { LOCK_PERMISSIONS, LockService } = await import('./locks');

const GUILD_ID = '900000000000000000';
const EVERYONE = GUILD_ID;
const EXTRA_ROLE = '700000000000000001';
const MEMBER = '300000000000000000';

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

  it('apaga a linha do lock quando o Discord recusa os overwrites', async () => {
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
    expect(deleteChannelLock).toHaveBeenCalledWith({}, GUILD_ID, channel.id);
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
  });

  it('unlock sem lock gravado não mexe no canal', async () => {
    const channel = fakeChannel([]);
    deleteChannelLock.mockResolvedValue(null);

    const outcome = await new LockService({} as never).unlock({
      guildId: GUILD_ID,
      channel,
      reason: 'fim',
    });

    expect(outcome).toBe('not-locked');
    expect(channel.permissionOverwrites.set).not.toHaveBeenCalled();
  });
});
