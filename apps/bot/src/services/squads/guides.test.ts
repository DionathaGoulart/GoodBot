import { ChannelType, DiscordAPIError, PermissionFlagsBits, RESTJSONErrorCodes } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ALICE, CATEGORY, fakeRoomGuild, GUILD, squadsConfig } from './__fixtures__/rooms';
import { CALL_ID, MINE_ID, NOTIFY_TOGGLE_ID, SCHEDULE_ID } from './ids';

import type { SquadsConfig } from '@goodbot/shared';

const { setModuleConfig } = vi.hoisted(() => ({ setModuleConfig: vi.fn() }));
vi.mock('@goodbot/db', () => ({ setModuleConfig }));

const { chatGuideMessage, deskButtonsMessage, deskGuideMessage, SquadGuideService } =
  await import('./guides');

const CHAT = '300000000000000010';
const DESK = '300000000000000011';
const BORA = '700000000000000001';
const OLD_CHAT_GUIDE = '600000000000000001';
const OLD_DESK_GUIDE = '600000000000000002';
const OLD_BUTTONS = '600000000000000003';

function apiError(code: number): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: 'x' },
    code,
    404,
    'PATCH',
    'https://discord.test',
    {},
  );
}

function withChannels(overrides: Partial<SquadsConfig> = {}): SquadsConfig {
  return squadsConfig({
    chatChannelId: CHAT,
    deskChannelId: DESK,
    notifyRoleId: BORA,
    ...overrides,
  });
}

function published(overrides: Partial<SquadsConfig> = {}): SquadsConfig {
  return withChannels({
    chatGuideMessageId: OLD_CHAT_GUIDE,
    deskGuideMessageId: OLD_DESK_GUIDE,
    deskButtonsMessageId: OLD_BUTTONS,
    ...overrides,
  });
}

/** Canal de texto com envio que devolve `base + 1`, `base + 2`... */
function textChannel(h: ReturnType<typeof fakeRoomGuild>, id: string, name: string, base: bigint) {
  const channel = h.addChannel({ id, type: ChannelType.GuildText, name, parentId: CATEGORY });
  const pin = vi.fn(() => Promise.resolve());
  const edit = vi.fn((_id: string, _body: unknown) => Promise.resolve());
  const remove = vi.fn(() => Promise.resolve());
  let next = 0;
  const send = vi.fn((_body: unknown) => {
    next += 1;
    return Promise.resolve({ id: String(base + BigInt(next)), pin });
  });
  Object.assign(channel, { messages: { edit, delete: remove }, send });
  return { channel, pin, edit, remove, send };
}

function setup(config: SquadsConfig = withChannels()) {
  const h = fakeRoomGuild();
  const chat = textChannel(h, CHAT, 'buscar-squad', 610000000000000000n);
  const desk = textChannel(h, DESK, 'jogatinas', 620000000000000000n);
  const current = { config };
  const invalidate = vi.fn();
  const record = vi.fn();
  const served = [GUILD];
  const service = new SquadGuideService({
    client: h.client,
    db: {} as never,
    config: {
      get: () => Promise.resolve(current.config),
      getSettings: () => Promise.resolve({ embedColor: 0xdc143c }),
      publishInvalidate: invalidate,
    } as never,
    audit: { record },
    registry: { servedGuildIds: () => served },
  });
  return { ...h, service, chat, desk, current, invalidate, record };
}

const ids = (body: ReturnType<typeof deskButtonsMessage>) =>
  (body.components ?? []).flatMap((row) =>
    row.components.map((button) => (button.data as { custom_id: string }).custom_id),
  );

describe('texto dos guias', () => {
  it('o guia do chat só cita o cargo e o canal de jogatinas quando existem', () => {
    const full = chatGuideMessage(withChannels()).embeds[0]?.data.description ?? '';
    expect(full).toContain('`/procurar`');
    expect(full).toContain(`<@&${BORA}>`);
    expect(full).toContain(`<#${DESK}>`);

    const bare = chatGuideMessage(withChannels({ notifyRoleId: null, deskChannelId: null }))
      .embeds[0]?.data.description;
    expect(bare).toContain('`/procurar`');
    expect(bare).not.toContain('/avisos');
    expect(bare).not.toContain('<#');
  });

  it('o guia do jogatinas mostra os três canais e os quatro comandos', () => {
    const text = JSON.stringify(deskGuideMessage(withChannels({ agendaChannelId: null })));
    expect(text).toContain(`<#${CHAT}>`);
    expect(text).toContain('**#agenda**');
    for (const command of ['/procurar', '/marcar', '/jogatinas', '/avisos']) {
      expect(text).toContain(command);
    }
    expect(text).not.toContain('—');
  });

  it('os botões são os quatro do PRD, na ordem', () => {
    expect(ids(deskButtonsMessage())).toEqual([CALL_ID, SCHEDULE_ID, MINE_ID, NOTIFY_TOGGLE_ID]);
  });
});

describe('SquadGuideService.publish', () => {
  beforeEach(() => {
    setModuleConfig.mockReset();
  });

  it('sem nada no ar, publica as três, fixa só a do chat e grava os ids de uma vez', async () => {
    const h = setup();
    const result = await h.service.publish(h.guild, ALICE, 'command');
    expect(result).toEqual({
      chatGuide: { channelId: CHAT, messageId: '610000000000000001', created: true },
      deskGuide: { channelId: DESK, messageId: '620000000000000001', created: true },
      deskButtons: { channelId: DESK, messageId: '620000000000000002', created: true },
    });
    expect(h.chat.pin).toHaveBeenCalledOnce();
    expect(h.desk.pin).not.toHaveBeenCalled();
    expect(setModuleConfig).toHaveBeenCalledOnce();
    expect(setModuleConfig).toHaveBeenCalledWith(
      expect.anything(),
      GUILD,
      'squads',
      expect.objectContaining({
        chatChannelId: CHAT,
        notifyRoleId: BORA,
        chatGuideMessageId: '610000000000000001',
        deskGuideMessageId: '620000000000000001',
        deskButtonsMessageId: '620000000000000002',
      }),
      ALICE,
    );
    expect(h.invalidate).toHaveBeenCalledWith(GUILD, 'squads');
    expect(h.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'squad.guides.publish', actor: ALICE, source: 'command' }),
    );
  });

  it('com tudo no ar, só reedita e não mexe no config', async () => {
    const h = setup(published());
    const result = await h.service.publish(h.guild, ALICE, 'dashboard');
    expect(result.chatGuide).toEqual({
      channelId: CHAT,
      messageId: OLD_CHAT_GUIDE,
      created: false,
    });
    expect(h.chat.edit).toHaveBeenCalledWith(OLD_CHAT_GUIDE, expect.anything());
    expect(h.desk.edit).toHaveBeenCalledTimes(2);
    expect(h.chat.send).not.toHaveBeenCalled();
    expect(h.desk.send).not.toHaveBeenCalled();
    expect(setModuleConfig).not.toHaveBeenCalled();
  });

  it('guia apagado volta; o do jogatinas leva os botões para baixo dele', async () => {
    const h = setup(published());
    h.chat.edit.mockRejectedValueOnce(apiError(RESTJSONErrorCodes.UnknownMessage));
    h.desk.edit.mockRejectedValueOnce(apiError(RESTJSONErrorCodes.UnknownMessage));
    const result = await h.service.publish(h.guild, ALICE, 'command');
    expect(result.chatGuide?.created).toBe(true);
    expect(h.chat.pin).toHaveBeenCalledOnce();
    expect(result.deskGuide?.created).toBe(true);
    expect(h.desk.remove).toHaveBeenCalledWith(OLD_BUTTONS);
    expect(result.deskButtons?.created).toBe(true);
    // Uma edição só no jogatinas: a do guia, que falhou. Os botões nasceram de novo.
    expect(h.desk.edit).toHaveBeenCalledOnce();
    expect(h.desk.send).toHaveBeenCalledTimes(2);
  });

  it('falha passageira não republica', async () => {
    const h = setup(published());
    h.chat.edit.mockRejectedValueOnce(new Error('Service Unavailable'));
    await expect(h.service.publish(h.guild, ALICE, 'command')).rejects.toThrow('Service');
    expect(h.chat.send).not.toHaveBeenCalled();
  });

  it('sem pin a mensagem fica no ar assim mesmo', async () => {
    const h = setup();
    h.chat.pin.mockRejectedValueOnce(apiError(RESTJSONErrorCodes.MissingPermissions));
    await expect(h.service.publish(h.guild, ALICE, 'command')).resolves.toMatchObject({
      chatGuide: { created: true },
    });
  });

  it('só o chat configurado: o jogatinas fica nulo', async () => {
    const h = setup(withChannels({ deskChannelId: null }));
    const result = await h.service.publish(h.guild, ALICE, 'command');
    expect(result.chatGuide?.created).toBe(true);
    expect(result.deskGuide).toBeNull();
    expect(result.deskButtons).toBeNull();
  });

  it('a falta ensina e nada é escrito', async () => {
    const off = setup(withChannels({ enabled: false }));
    await expect(off.service.publish(off.guild, ALICE, 'command')).rejects.toMatchObject({
      code: 'MODULE_DISABLED',
    });

    const none = setup(withChannels({ chatChannelId: null, deskChannelId: null }));
    await expect(none.service.publish(none.guild, ALICE, 'command')).rejects.toMatchObject({
      code: 'SQUADS_NO_GUIDE_CHANNEL',
    });

    const voice = setup(withChannels({ deskChannelId: CATEGORY }));
    await expect(voice.service.publish(voice.guild, ALICE, 'command')).rejects.toMatchObject({
      code: 'SQUADS_BAD_CHANNEL',
    });
    expect(voice.chat.send).not.toHaveBeenCalled();

    const denied = setup();
    denied.denied.add(PermissionFlagsBits.EmbedLinks);
    await expect(denied.service.publish(denied.guild, ALICE, 'command')).rejects.toMatchObject({
      code: 'MISSING_PERMISSIONS',
    });
    expect(denied.chat.send).not.toHaveBeenCalled();
    expect(setModuleConfig).not.toHaveBeenCalled();
  });
});

describe('SquadGuideService no boot', () => {
  beforeEach(() => {
    setModuleConfig.mockReset();
  });

  it('confere uma vez, e de novo quando a staff troca um canal', async () => {
    const h = setup(published());
    await h.service.tick();
    await h.service.tick();
    expect(h.chat.edit).toHaveBeenCalledOnce();

    h.current.config = published({ chatChannelId: DESK, deskChannelId: CHAT });
    await h.service.tick();
    expect(h.chat.edit.mock.calls.length + h.desk.edit.mock.calls.length).toBeGreaterThan(3);
  });

  it('módulo desligado não publica; ligar publica', async () => {
    const h = setup(withChannels({ enabled: false }));
    await h.service.tick();
    expect(h.chat.send).not.toHaveBeenCalled();

    h.current.config = withChannels();
    await h.service.tick();
    expect(h.chat.send).toHaveBeenCalledOnce();
    expect(h.record).not.toHaveBeenCalled();
    expect(setModuleConfig).toHaveBeenCalledWith(
      expect.anything(),
      GUILD,
      'squads',
      expect.anything(),
      null,
    );
  });

  it('canal inutilizável só vai para o log, e o outro sai', async () => {
    const h = setup(withChannels({ deskChannelId: CATEGORY }));
    await expect(h.service.tick()).resolves.toBeUndefined();
    expect(h.chat.send).toHaveBeenCalledOnce();
  });

  it('erro do Discord no boot não lança', async () => {
    const h = setup(published());
    h.chat.edit.mockRejectedValueOnce(new Error('Service Unavailable'));
    await expect(h.service.tick()).resolves.toBeUndefined();
  });
});
