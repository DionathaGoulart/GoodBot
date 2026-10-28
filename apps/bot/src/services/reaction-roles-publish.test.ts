import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPanel = vi.fn();
const setPanelMessage = vi.fn();

vi.mock('@goodbot/db', () => ({
  getPanel: (...args: unknown[]) => getPanel(...args),
  setPanelMessage: (...args: unknown[]) => setPanelMessage(...args),
}));

const { ReactionRoleService } = await import('./reaction-roles');

beforeEach(() => {
  vi.clearAllMocks();
  getPanel.mockResolvedValue({
    id: 'panel',
    guildId: 'guild',
    channelId: 'channel',
    messageId: 'old-message',
    mode: 'single',
    style: 'buttons',
    content: { content: 'Escolha' },
    items: [],
  });
});

function fixture(fetchError: Error) {
  const send = vi.fn().mockResolvedValue({ id: 'new-message' });
  const channel = {
    isTextBased: () => true,
    messages: { fetch: vi.fn().mockRejectedValue(fetchError) },
    send,
  };
  const guild = { id: 'guild', channels: { fetch: vi.fn().mockResolvedValue(channel) } };
  const service = new ReactionRoleService({
    db: {} as never,
    client: {} as never,
    config: { getSettings: () => Promise.resolve({ embedColor: 0x123456 }) } as never,
  });
  return { service, guild, send };
}

describe('publicação de painel já publicado', () => {
  it('não duplica a mensagem quando a busca falha temporariamente', async () => {
    const { service, guild, send } = fixture(new Error('Discord indisponível'));

    await expect(service.publishPanel(guild as never, 'panel')).rejects.toThrow(
      'Discord indisponível',
    );
    expect(send).not.toHaveBeenCalled();
    expect(setPanelMessage).not.toHaveBeenCalled();
  });

  it('cria mensagem nova quando o Discord confirma que a antiga não existe', async () => {
    const missing = new DiscordAPIError(
      { code: RESTJSONErrorCodes.UnknownMessage } as never,
      RESTJSONErrorCodes.UnknownMessage,
      404,
      'GET',
      'https://discord.test/messages/old-message',
      {},
    );
    const { service, guild, send } = fixture(missing);

    await service.publishPanel(guild as never, 'panel');
    expect(send).toHaveBeenCalledTimes(1);
    expect(setPanelMessage).toHaveBeenCalledWith({}, 'panel', 'channel', 'new-message');
  });
});
