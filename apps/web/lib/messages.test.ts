import { beforeEach, describe, expect, it, vi } from 'vitest';

const GUILD_ID = '100000000000000000';
const ACTOR = '200000000000000002';
const CHANNEL = '300000000000000003';
const MESSAGE = '400000000000000004';

const sendMessage = vi.fn();
const deleteMessage = vi.fn();
const channelMessages = vi.fn();
const withAudit = vi.fn();

/** O nível que `requireGuildAccess` vai conceder no teste da vez. */
let level: 'mod' | 'admin' = 'admin';

vi.mock('server-only', () => ({}));
vi.mock('./db', () => ({ db: () => ({}) }));
vi.mock('./audit', () => ({ withAudit: (...args: unknown[]) => withAudit(...args) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('./internal-api', () => ({
  internalApi: () => ({ sendMessage, deleteMessage, channelMessages }),
}));
vi.mock('./auth/require', () => ({
  defaultGuildId: () => GUILD_ID,
  requireGuildAccess: (_guildId: string, minimum: 'mod' | 'admin') => {
    // O `requireGuildAccess` de verdade faz `redirect()`, que lança; o mock
    // imita isso, que é o que importa: a action nunca chega a escrever.
    if (minimum === 'admin' && level !== 'admin') throw new Error('NEXT_REDIRECT');
    return Promise.resolve({
      user: { id: ACTOR, name: 'admin#1', image: null },
      level,
      guildId: GUILD_ID,
    });
  },
}));

const { sendChannelMessage, deleteChannelMessage } = await import('./messages');

function compose(body: Record<string, unknown>): FormData {
  const formData = new FormData();
  formData.set('message', JSON.stringify({ channelId: CHANNEL, ...body }));
  return formData;
}

beforeEach(() => {
  level = 'admin';
  vi.clearAllMocks();
  sendMessage.mockResolvedValue({ channelId: CHANNEL, messageId: MESSAGE });
  channelMessages.mockResolvedValue([]);
});

describe('sendChannelMessage', () => {
  it('manda sem mencionar ninguém quando o formulário não marcou nada', async () => {
    const result = await sendChannelMessage(compose({ template: { content: 'olá' } }));

    expect(result.ok).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(GUILD_ID, {
      kind: 'dashboard',
      channelId: CHANNEL,
      template: { content: 'olá' },
      allowedMentions: { users: false, roles: false, everyone: false },
      actorId: ACTOR,
    });
  });

  it('registra na auditoria o conteúdo do que saiu', async () => {
    await sendChannelMessage(compose({ template: { content: 'olá' } }));

    expect(withAudit).toHaveBeenCalledWith(
      { id: ACTOR, tag: 'admin#1' },
      'message.send',
      { type: 'message', id: MESSAGE },
      null,
      expect.objectContaining({ template: { content: 'olá' } }),
    );
  });

  it('recusa @everyone de quem não é admin do painel', async () => {
    level = 'mod';

    await expect(
      sendChannelMessage(
        compose({ template: { content: 'ei' }, allowedMentions: { everyone: true } }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('recusa mensagem vazia antes de falar com o bot', async () => {
    const result = await sendChannelMessage(compose({ template: { content: '  ' } }));

    expect(result.ok).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('guarda o conteúdo anterior ao editar', async () => {
    channelMessages.mockResolvedValue([{ id: MESSAGE, content: 'antes' }]);

    await sendChannelMessage(compose({ messageId: MESSAGE, template: { content: 'depois' } }));

    expect(withAudit).toHaveBeenCalledWith(
      { id: ACTOR, tag: 'admin#1' },
      'message.edit',
      { type: 'message', id: MESSAGE },
      { id: MESSAGE, content: 'antes' },
      expect.objectContaining({ template: { content: 'depois' } }),
    );
  });
});

describe('deleteChannelMessage', () => {
  it('audita o que foi apagado', async () => {
    deleteMessage.mockResolvedValue({ id: MESSAGE, content: 'tchau' });
    const formData = new FormData();
    formData.set('channelId', CHANNEL);
    formData.set('messageId', MESSAGE);

    const result = await deleteChannelMessage(formData);

    expect(result.ok).toBe(true);
    expect(withAudit).toHaveBeenCalledWith(
      { id: ACTOR, tag: 'admin#1' },
      'message.delete',
      { type: 'message', id: MESSAGE },
      { id: MESSAGE, content: 'tchau' },
      null,
    );
  });

  it('não deixa `mod` apagar', async () => {
    level = 'mod';
    const formData = new FormData();
    formData.set('channelId', CHANNEL);
    formData.set('messageId', MESSAGE);

    await expect(deleteChannelMessage(formData)).rejects.toThrow('NEXT_REDIRECT');
    expect(deleteMessage).not.toHaveBeenCalled();
  });
});
