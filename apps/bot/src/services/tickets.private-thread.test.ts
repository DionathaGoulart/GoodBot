import { DEFAULT_TICKETS_CONFIG } from '@goodbot/shared';
import { ChannelType } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getTicketType, reserveTicketOpening, releaseTicketOpening } = vi.hoisted(() => ({
  getTicketType: vi.fn(),
  reserveTicketOpening: vi.fn(),
  releaseTicketOpening: vi.fn(),
}));

vi.mock('@goodbot/db', () => ({
  getTicketType,
  reserveTicketOpening,
  releaseTicketOpening,
}));

const { TicketService } = await import('./tickets');

const guildId = '900000000000000001';
const roleId = '900000000000000002';
const userId = '900000000000000003';

function fixture(hasAccess: boolean, authorCanSend = true) {
  const create = vi.fn();
  const parent = {
    type: ChannelType.GuildText,
    permissionsFor: vi.fn().mockReturnValue({ has: () => hasAccess }),
    threads: { create },
  };
  const role = { id: roleId };
  const guild = {
    id: guildId,
    name: 'Teste',
    memberCount: 5,
    channels: { fetch: vi.fn().mockResolvedValue(parent) },
    roles: { cache: { get: () => role } },
  };
  const member = {
    id: userId,
    guild,
    user: { username: 'membro', displayName: 'membro', tag: 'membro' },
    permissionsIn: vi.fn().mockReturnValue({ has: () => authorCanSend }),
  };
  const config = {
    get: vi.fn().mockResolvedValue({
      ...DEFAULT_TICKETS_CONFIG,
      enabled: true,
      useThreads: true,
    }),
  };
  const service = new TicketService({ db: {} as never, config: config as never });
  return { service, member, create, parent, role };
}

beforeEach(() => {
  vi.clearAllMocks();
  getTicketType.mockResolvedValue({
    id: 'type-1',
    guildId,
    categoryId: '900000000000000004',
    name: 'Suporte',
    supportRoleIds: [roleId],
    maxOpenPerUser: null,
    namingPattern: null,
  });
  reserveTicketOpening.mockResolvedValue({ reserved: true, id: 'reservation-1', number: 1 });
  releaseTicketOpening.mockResolvedValue(undefined);
});

describe('ticket em thread privada', () => {
  it('recusa criação se o cargo de suporte não pode ver e responder na thread', async () => {
    const { service, member, create, parent, role } = fixture(false);
    await expect(service.open(member as never, 'type-1')).rejects.toMatchObject({
      code: 'THREAD_SUPPORT_ACCESS',
    });
    expect(parent.permissionsFor).toHaveBeenCalledWith(role);
    expect(create).not.toHaveBeenCalled();
    expect(releaseTicketOpening).toHaveBeenCalledWith({}, 'reservation-1');
  });

  it('recusa criação se o autor não pode escrever em threads no canal pai', async () => {
    const { service, member, create } = fixture(true, false);
    await expect(service.open(member as never, 'type-1')).rejects.toMatchObject({
      code: 'THREAD_AUTHOR_ACCESS',
    });
    expect(create).not.toHaveBeenCalled();
    expect(releaseTicketOpening).toHaveBeenCalledWith({}, 'reservation-1');
  });
});
