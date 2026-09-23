import { ChannelType, DiscordAPIError, PermissionFlagsBits, RESTJSONErrorCodes } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ALICE,
  BOB,
  CATEGORY,
  fakeRoomGuild,
  GUILD,
  PANEL,
  squadsConfig,
} from './__fixtures__/rooms';
import { OPT_OUT_TOGGLE_ID, SEARCH_TOGGLE_ID } from './ids';

import type { SquadsConfig } from '@goodbot/shared';

const { setModuleConfig } = vi.hoisted(() => ({ setModuleConfig: vi.fn() }));
vi.mock('@goodbot/db', () => ({ setModuleConfig }));

const { panelMessage, panelRooms, roomLine, SquadPanelService } = await import('./panel');

const MESSAGE = '600000000000000001';

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

describe('texto do painel', () => {
  it('sala com vaga chama, sala cheia avisa', () => {
    expect(roomLine({ channelId: '1', occupants: 1, limit: 4 })).toBe(
      '🟢 <#1> · 1/4 · clique pra entrar',
    );
    expect(roomLine({ channelId: '2', occupants: 4, limit: 4 })).toBe('🔴 <#2> · 4/4 · lotada');
  });

  it('sem sala, aponta o canal de criar', () => {
    const body = panelMessage([], squadsConfig());
    expect(body.embeds[0]?.data.description).toContain('Ninguém em sala agora');
    expect(body.embeds[0]?.data.description).toContain('<#300000000000000002>');
  });

  it('só mostra o botão do cargo que está configurado', () => {
    const ids = (config: SquadsConfig) =>
      panelMessage([], config).components.flatMap((row) =>
        row.components.map((button) => (button.data as { custom_id: string }).custom_id),
      );
    expect(ids(squadsConfig())).toEqual([SEARCH_TOGGLE_ID, OPT_OUT_TOGGLE_ID]);
    expect(ids(squadsConfig({ optOutRoleId: null }))).toEqual([SEARCH_TOGGLE_ID]);
    expect(ids(squadsConfig({ searchRoleId: null, optOutRoleId: null }))).toEqual([]);
  });

  it('lista só sala com gente, na ordem grega, com o teto do canal', () => {
    const h = fakeRoomGuild();
    h.addChannel({
      id: '11',
      type: ChannelType.GuildVoice,
      name: 'Squad Gama',
      parentId: CATEGORY,
    });
    h.addChannel({
      id: '12',
      type: ChannelType.GuildVoice,
      name: 'Squad Alfa',
      parentId: CATEGORY,
      userLimit: 2,
    });
    h.addChannel({
      id: '13',
      type: ChannelType.GuildVoice,
      name: 'Squad Beta',
      parentId: CATEGORY,
    });
    h.setVoice(ALICE, '11');
    h.setVoice(BOB, '12');
    expect(panelRooms(h.guild, squadsConfig())).toEqual([
      { channelId: '12', occupants: 1, limit: 2 },
      { channelId: '11', occupants: 1, limit: 4 },
    ]);
  });
});

function setup(config: SquadsConfig = squadsConfig({ panelMessageId: MESSAGE })) {
  const h = fakeRoomGuild();
  const panelChannel = h.addChannel({
    id: PANEL,
    type: ChannelType.GuildText,
    name: 'buscar-squad',
    parentId: CATEGORY,
  });
  const pin = vi.fn(() => Promise.resolve());
  const edit = vi.fn(() => Promise.resolve());
  const send = vi.fn(() => Promise.resolve({ id: '600000000000000002', pin }));
  Object.assign(panelChannel, { messages: { edit }, send });
  const current = { config };
  const invalidate = vi.fn();
  const record = vi.fn();
  const service = new SquadPanelService({
    client: h.client,
    db: {} as never,
    config: {
      get: () => Promise.resolve(current.config),
      getSettings: () => Promise.resolve({ embedColor: 0xdc143c }),
      publishInvalidate: invalidate,
    } as never,
    audit: { record },
  });
  return { ...h, service, edit, send, pin, invalidate, record, current };
}

describe('SquadPanelService', () => {
  beforeEach(() => {
    setModuleConfig.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesce várias mudanças numa edição só', async () => {
    vi.useFakeTimers();
    const h = setup();
    h.service.schedule(GUILD);
    h.service.schedule(GUILD);
    h.service.schedule(GUILD);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.edit).toHaveBeenCalledOnce();
    expect(h.edit).toHaveBeenCalledWith(MESSAGE, expect.anything());
    h.service.schedule(GUILD);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.edit).toHaveBeenCalledTimes(2);
  });

  it('mensagem apagada é publicada de novo, fixada e gravada', async () => {
    const h = setup();
    h.edit.mockRejectedValueOnce(apiError(RESTJSONErrorCodes.UnknownMessage));
    await h.service.refresh(GUILD);
    expect(h.send).toHaveBeenCalledOnce();
    expect(h.pin).toHaveBeenCalledOnce();
    expect(setModuleConfig).toHaveBeenCalledWith(
      expect.anything(),
      GUILD,
      'squads',
      expect.objectContaining({ panelMessageId: '600000000000000002' }),
      null,
    );
    expect(h.invalidate).toHaveBeenCalledWith(GUILD, 'squads');
  });

  it('falha passageira não republica nem lança', async () => {
    const h = setup();
    h.edit.mockRejectedValueOnce(new Error('Service Unavailable'));
    await expect(h.service.refresh(GUILD)).resolves.toBeUndefined();
    expect(h.send).not.toHaveBeenCalled();
  });

  it('sem mensagem publicada, refresh não posta nada', async () => {
    const h = setup(squadsConfig());
    await h.service.refresh(GUILD);
    expect(h.edit).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });

  it('publicar posta e fixa quando não há mensagem, e edita quando há', async () => {
    const fresh = setup(squadsConfig());
    const created = await fresh.service.publish(fresh.guild, ALICE, 'command');
    expect(created).toEqual({ channelId: PANEL, messageId: '600000000000000002', created: true });
    expect(fresh.pin).toHaveBeenCalledOnce();
    expect(fresh.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'squad.panel.publish', actor: ALICE }),
    );

    const live = setup();
    const edited = await live.service.publish(live.guild, ALICE, 'dashboard');
    expect(edited).toEqual({ channelId: PANEL, messageId: MESSAGE, created: false });
    expect(live.send).not.toHaveBeenCalled();
  });

  it('sem pin a mensagem fica no ar assim mesmo', async () => {
    const h = setup(squadsConfig());
    h.pin.mockRejectedValueOnce(apiError(RESTJSONErrorCodes.MissingPermissions));
    await expect(h.service.publish(h.guild, ALICE, 'command')).resolves.toMatchObject({
      created: true,
    });
    expect(setModuleConfig).toHaveBeenCalledOnce();
  });

  it('publicar sem canal, com canal de voz ou sem permissão ensina o que falta', async () => {
    const none = setup(squadsConfig({ panelChannelId: null }));
    await expect(none.service.publish(none.guild, ALICE, 'command')).rejects.toMatchObject({
      code: 'SQUADS_NO_PANEL_CHANNEL',
    });

    const voice = setup(squadsConfig({ panelChannelId: '300000000000000002' }));
    await expect(voice.service.publish(voice.guild, ALICE, 'command')).rejects.toMatchObject({
      code: 'SQUADS_NO_PANEL_CHANNEL',
    });

    const denied = setup(squadsConfig());
    denied.denied.add(PermissionFlagsBits.EmbedLinks);
    await expect(denied.service.publish(denied.guild, ALICE, 'command')).rejects.toMatchObject({
      code: 'MISSING_PERMISSIONS',
    });
  });

  it('módulo desligado não publica', async () => {
    const h = setup(squadsConfig({ enabled: false }));
    await expect(h.service.publish(h.guild, ALICE, 'command')).rejects.toMatchObject({
      code: 'MODULE_DISABLED',
    });
  });
});
