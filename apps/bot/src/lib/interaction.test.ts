import { Collection, MessageFlags } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createInteractionHandler } from './interaction';
import { DEFAULT_SETTINGS } from '../services/config';

import type { BotContext } from './command';
import type { Interaction } from 'discord.js';

const GUILD_ID = '100000000000000001';
const USER_ID = '200000000000000002';

const execute = vi.fn(() => Promise.resolve());

function fakeCommand() {
  return {
    data: { name: 'ping', toJSON: () => ({ name: 'ping' }) },
    module: 'utilities',
    level: 'member',
    execute,
  };
}

function fakeInteraction() {
  const reply = vi.fn(() => Promise.resolve());
  const interaction = {
    inGuild: () => true,
    guildId: GUILD_ID,
    channelId: '300000000000000003',
    commandName: 'ping',
    user: { id: USER_ID },
    member: {
      id: USER_ID,
      guild: { id: GUILD_ID, ownerId: '400000000000000004' },
      user: { id: USER_ID, bot: false },
      permissions: { has: () => false },
      roles: { cache: new Collection<string, { id: string }>(), highest: { position: 1 } },
    },
    replied: false,
    deferred: false,
    reply,
    editReply: vi.fn(() => Promise.resolve()),
    followUp: vi.fn(() => Promise.resolve()),
    deferReply: vi.fn(() => Promise.resolve()),
    isAutocomplete: () => false,
    isMessageComponent: () => false,
    isModalSubmit: () => false,
    isChatInputCommand: () => true,
    isUserContextMenuCommand: () => false,
    isRepliable: () => true,
  };
  return { interaction: interaction as unknown as Interaction, reply };
}

function fakeCtx(options: { serves?: boolean; maintenance?: boolean }): BotContext {
  return {
    registry: { serves: () => options.serves ?? true },
    maintenance: {
      active: () => options.maintenance ?? false,
      message: () => 'volto já',
    },
    commands: new Collection([['ping', fakeCommand()]]),
    config: {
      getSettings: () => Promise.resolve({ guildId: GUILD_ID, ...DEFAULT_SETTINGS, stored: true }),
      get: () => Promise.resolve({ commandOverrides: {} }),
    },
    stats: { recordCommand: vi.fn() },
  } as unknown as BotContext;
}

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * O portão da manutenção. O que ele precisa garantir é a diferença entre "em
 * manutenção" e "caiu": o bot continua respondendo — só que com um aviso — em
 * vez de deixar a interação sem resposta, que é o que vira "falha na
 * interação" na tela de quem tentou.
 */
describe('modo manutenção', () => {
  it('recusa o comando com aviso efêmero e não executa nada', async () => {
    const handler = createInteractionHandler();
    const { interaction, reply } = fakeInteraction();

    await handler(fakeCtx({ maintenance: true }), interaction);

    expect(execute).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
  });

  it('desligada, o comando roda normalmente', async () => {
    const handler = createInteractionHandler();
    const { interaction, reply } = fakeInteraction();

    await handler(fakeCtx({ maintenance: false }), interaction);

    expect(execute).toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it('não fala em guild que o bot não atende, nem para avisar da manutenção', async () => {
    const handler = createInteractionHandler();
    const { interaction, reply } = fakeInteraction();

    await handler(fakeCtx({ serves: false, maintenance: true }), interaction);

    expect(execute).not.toHaveBeenCalled();
    // O silêncio vem antes: um servidor à espera de aprovação não deve nem
    // saber que o bot está em manutenção.
    expect(reply).not.toHaveBeenCalled();
  });
});

/**
 * A DM não tem guild, e o portão do registro calaria o botão do aviso de
 * squad. Ele passa por um desvio próprio, que confere a guild do `custom_id`.
 */
describe('botão de squad na DM', () => {
  function dmButton(customId: string) {
    const editReply = vi.fn(() => Promise.resolve());
    const interaction = {
      inGuild: () => false,
      guildId: null,
      customId,
      user: { id: USER_ID },
      replied: false,
      deferred: false,
      reply: vi.fn(() => Promise.resolve()),
      editReply,
      followUp: vi.fn(() => Promise.resolve()),
      deferUpdate: vi.fn(function (this: { deferred: boolean }) {
        this.deferred = true;
        return Promise.resolve();
      }),
      isButton: () => true,
      isRepliable: () => true,
    };
    return { interaction: interaction as unknown as Interaction, editReply };
  }

  it('guild fora do registro responde com erro em vez de falhar mudo', async () => {
    const handler = createInteractionHandler();
    const { interaction, editReply } = dmButton(`squad:dm:search:${GUILD_ID}`);
    const ctx = { ...fakeCtx({ serves: false }), client: { guilds: { cache: new Map() } } };

    await handler(ctx as unknown as BotContext, interaction);

    expect(editReply).toHaveBeenCalledTimes(1);
  });

  it('outro botão de DM segue ignorado', async () => {
    const handler = createInteractionHandler();
    const { interaction, editReply } = dmButton('ticket:close');

    await handler(fakeCtx({}), interaction);

    expect(editReply).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
