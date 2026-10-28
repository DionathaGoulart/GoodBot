import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getTicketType } = vi.hoisted(() => ({ getTicketType: vi.fn() }));
vi.mock('@goodbot/db', () => ({ getTicketType }));

const { handleTicketComponent } = await import('./tickets');

const guildId = '900000000000000001';
const authorId = '900000000000000002';
const supportId = '900000000000000003';
const supportRoleId = '900000000000000004';

function fixture(actorId: string, hasSupportRole: boolean, action: 'claim' | 'close') {
  const editReply = vi.fn().mockResolvedValue(undefined);
  const member = {
    id: actorId,
    user: { bot: false },
    guild: { ownerId: '900000000000000099' },
    roles: {
      cache: {
        has: (roleId: string) => hasSupportRole && roleId === supportRoleId,
        map: (callback: (role: { id: string }) => string) =>
          hasSupportRole ? [callback({ id: supportRoleId })] : [],
      },
      highest: { position: 1 },
    },
    permissions: { has: () => false },
  };
  const channel = {
    id: '900000000000000005',
    isTextBased: () => true,
    isDMBased: () => false,
    send: vi.fn().mockResolvedValue(undefined),
  };
  const interaction = {
    customId: `ticket:${action}`,
    guildId,
    member,
    channel,
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply,
  };
  const ticket = {
    id: 1,
    guildId,
    channelId: channel.id,
    userId: authorId,
    typeId: 'type-1',
    claimedBy: null,
  };
  const claim = vi.fn().mockResolvedValue({ ...ticket, number: 1, claimedBy: actorId });
  const close = vi.fn().mockResolvedValue({ ...ticket, status: 'closed' });
  const ctx = {
    db: {},
    config: { getSettings: vi.fn().mockResolvedValue({ adminRoleIds: [], modRoleIds: [] }) },
    tickets: {
      requireConfig: vi.fn().mockResolvedValue({ closeConfirm: false }),
      requireTicketFor: vi.fn().mockResolvedValue(ticket),
      claim,
      close,
    },
    logger: { error: vi.fn() },
  };
  return { ctx, interaction, claim, close, editReply };
}

beforeEach(() => {
  vi.clearAllMocks();
  getTicketType.mockResolvedValue({ supportRoleIds: [supportRoleId] });
});

describe('permissões do ticket', () => {
  it('autor não consegue assumir o próprio ticket', async () => {
    const { ctx, interaction, claim, editReply } = fixture(authorId, false, 'claim');
    await handleTicketComponent(ctx as never, interaction as never);
    expect(claim).not.toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith({
      content: 'Só a equipe de suporte pode assumir tickets.',
    });
  });

  it('equipe consegue assumir o ticket', async () => {
    const { ctx, interaction, claim } = fixture(supportId, true, 'claim');
    await handleTicketComponent(ctx as never, interaction as never);
    expect(claim).toHaveBeenCalledWith(expect.objectContaining({ userId: authorId }), supportId);
  });

  it('autor ainda consegue fechar o próprio ticket', async () => {
    const { ctx, interaction, close } = fixture(authorId, false, 'close');
    await handleTicketComponent(ctx as never, interaction as never);
    expect(close).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      actorId: authorId,
      reason: null,
    });
  });
});
