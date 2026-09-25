import { GREEK_ROOM_NAMES, MAX_GUILD_CHANNELS, MINUTE_MS } from '@goodbot/shared';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { describe, expect, it, type vi } from 'vitest';

import {
  ALICE,
  BOB,
  CATEGORY,
  fakeRoomGuild,
  GUILD,
  LOBBY,
  squadsConfig,
  voiceState,
} from './__fixtures__/rooms';
import { isSquadRoom, nextRoomName, roomChannelName, roomIndex, SquadRoomService } from './rooms';

import type { SquadsConfig } from '@goodbot/shared';

describe('nomes de sala', () => {
  it('monta e reconhece `Squad <nome grego>`', () => {
    expect(roomChannelName('Alfa')).toBe('Squad Alfa');
    expect(roomIndex('Squad Alfa')).toBe(0);
    expect(roomIndex('Squad Ômega')).toBe(23);
    expect(roomIndex('Squad alfa')).toBeNull();
    expect(roomIndex('Alfa')).toBeNull();
  });

  it('pega o primeiro livre na ordem do alfabeto, inclusive buraco', () => {
    expect(nextRoomName([])).toBe('Alfa');
    expect(nextRoomName(['Squad Alfa', 'Squad Gama', 'Geral'])).toBe('Beta');
  });

  it('devolve null com os 24 em uso', () => {
    expect(nextRoomName(GREEK_ROOM_NAMES.map(roomChannelName))).toBeNull();
  });

  it('só é sala voz da categoria com nome do pool', () => {
    const config = squadsConfig();
    const base = { id: '1', type: ChannelType.GuildVoice, parentId: CATEGORY, name: 'Squad Beta' };
    expect(isSquadRoom(base, config)).toBe(true);
    expect(isSquadRoom({ ...base, parentId: null }, config)).toBe(false);
    expect(isSquadRoom({ ...base, name: 'Squad do Zé' }, config)).toBe(false);
    expect(isSquadRoom({ ...base, type: ChannelType.GuildText }, config)).toBe(false);
    // O `➕ Criar Squad` da v1.8 que sobrou na categoria nunca é apagado.
    expect(isSquadRoom({ ...base, name: '➕ Criar Squad' }, config)).toBe(false);
    expect(isSquadRoom(base, squadsConfig({ categoryId: null }))).toBe(false);
  });
});

function setup(config: SquadsConfig = squadsConfig()) {
  const fake = fakeRoomGuild();
  let now = 1_000_000;
  const service = new SquadRoomService({
    client: fake.client,
    config: { get: () => Promise.resolve(config) } as never,
    registry: { servedGuildIds: () => [GUILD] },
    now: () => now,
  });
  return {
    ...fake,
    service,
    config,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** Uma sala sem reserva, com a pessoa já dentro, como o gateway a veria. */
async function openRoom(h: ReturnType<typeof setup>, userId: string) {
  const room = await h.service.openSessionRoom(h.guild, h.config, {
    slots: h.config.roomSize,
    members: null,
    until: h.now(),
  });
  if (!room) throw new Error('a sala não nasceu');
  h.setVoice(userId, room.id);
  await h.service.onVoiceState(
    voiceState(h.guild, userId, null),
    voiceState(h.guild, userId, room.id),
  );
  return h.channels.get(room.id)!;
}

describe('SquadRoomService', () => {
  it('cria a sala na categoria com o teto das vagas', async () => {
    const h = setup();
    await h.service.openSessionRoom(h.guild, h.config, { slots: 3, members: null, until: 0 });
    expect(h.guild.channels.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Squad Alfa',
        type: ChannelType.GuildVoice,
        parent: CATEGORY,
        userLimit: 3,
      }),
    );
  });

  it('duas salas ao mesmo tempo ganham nomes diferentes', async () => {
    const h = setup();
    const options = { slots: 4, members: null, until: 0 };
    await Promise.all([
      h.service.openSessionRoom(h.guild, h.config, options),
      h.service.openSessionRoom(h.guild, h.config, options),
    ]);
    const names = [...h.channels.values()].map((c) => c.name).filter((n) => n.startsWith('Squad'));
    expect(names.sort()).toEqual(['Squad Alfa', 'Squad Beta']);
  });

  it('pula nome em uso', async () => {
    const h = setup();
    h.addChannel({ id: '9', type: ChannelType.GuildVoice, name: 'Squad Alfa', parentId: CATEGORY });
    await h.service.openSessionRoom(h.guild, h.config, { slots: 4, members: null, until: 0 });
    expect(h.guild.channels.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Squad Beta' }),
    );
  });

  it('sem permissão, no teto de canais ou com os 24 nomes em uso: não cria', async () => {
    const options = { slots: 4, members: null, until: 0 };
    const noMove = setup();
    noMove.denied.add(PermissionFlagsBits.MoveMembers);
    expect(await noMove.service.openSessionRoom(noMove.guild, noMove.config, options)).toBeNull();
    expect(noMove.guild.channels.create).not.toHaveBeenCalled();

    const full = setup();
    for (let i = full.channels.size; i < MAX_GUILD_CHANNELS; i += 1) {
      full.addChannel({
        id: `x${String(i)}`,
        type: ChannelType.GuildText,
        name: 't',
        parentId: null,
      });
    }
    expect(await full.service.openSessionRoom(full.guild, full.config, options)).toBeNull();
    expect(full.guild.channels.create).not.toHaveBeenCalled();

    const names = setup();
    GREEK_ROOM_NAMES.forEach((name, i) => {
      names.addChannel({
        id: `r${String(i)}`,
        type: ChannelType.GuildVoice,
        name: roomChannelName(name),
        parentId: CATEGORY,
      });
    });
    expect(await names.service.openSessionRoom(names.guild, names.config, options)).toBeNull();
    expect(names.guild.channels.create).not.toHaveBeenCalled();
  });

  it('entrar num canal de voz qualquer não cria sala', async () => {
    const h = setup();
    h.setVoice(ALICE, LOBBY);
    await h.service.onVoiceState(
      voiceState(h.guild, ALICE, null),
      voiceState(h.guild, ALICE, LOBBY, h.member(ALICE)),
    );
    expect(h.guild.channels.create).not.toHaveBeenCalled();
  });

  it('sala que esvazia some depois da janela, e voltar dentro dela cancela', async () => {
    const h = setup();
    const room = await openRoom(h, ALICE);
    await h.service.tick(); // reconciliação da primeira vez, com a sala ocupada

    h.setVoice(ALICE, null);
    await h.service.onVoiceState(
      voiceState(h.guild, ALICE, room.id),
      voiceState(h.guild, ALICE, null),
    );

    h.advance(MINUTE_MS);
    h.setVoice(ALICE, room.id);
    await h.service.onVoiceState(
      voiceState(h.guild, ALICE, null),
      voiceState(h.guild, ALICE, room.id),
    );
    h.advance(5 * MINUTE_MS);
    await h.service.tick();
    expect(room.delete).not.toHaveBeenCalled();

    h.setVoice(ALICE, LOBBY);
    await h.service.onVoiceState(
      voiceState(h.guild, ALICE, room.id),
      voiceState(h.guild, ALICE, LOBBY),
    );
    h.advance(MINUTE_MS);
    await h.service.tick();
    expect(room.delete).not.toHaveBeenCalled();
    h.advance(MINUTE_MS);
    await h.service.tick();
    expect(room.delete).toHaveBeenCalledOnce();
  });

  it('com janela 0 a sala some na hora', async () => {
    const h = setup(squadsConfig({ graceMinutes: 0 }));
    const room = await openRoom(h, ALICE);
    h.setVoice(ALICE, null);
    await h.service.onVoiceState(
      voiceState(h.guild, ALICE, room.id),
      voiceState(h.guild, ALICE, null),
    );
    expect(room.delete).toHaveBeenCalledOnce();
  });

  it('sala com gente ainda não abre janela', async () => {
    const h = setup();
    const room = await openRoom(h, ALICE);
    h.setVoice(BOB, room.id);
    h.setVoice(ALICE, null);
    await h.service.onVoiceState(
      voiceState(h.guild, ALICE, room.id),
      voiceState(h.guild, ALICE, null),
    );
    expect(h.service.emptyRooms.size).toBe(0);
  });

  it('não apaga canal que a staff renomeou durante a janela', async () => {
    const h = setup();
    const room = await openRoom(h, ALICE);
    h.setVoice(ALICE, null);
    await h.service.onVoiceState(
      voiceState(h.guild, ALICE, room.id),
      voiceState(h.guild, ALICE, null),
    );
    room.name = 'Sala do evento';
    h.advance(3 * MINUTE_MS);
    await h.service.tick();
    expect(room.delete).not.toHaveBeenCalled();
  });

  it('no boot, sala vazia ganha a janela do zero', async () => {
    const h = setup();
    const empty = h.addChannel({
      id: '7',
      type: ChannelType.GuildVoice,
      name: 'Squad Gama',
      parentId: CATEGORY,
    });
    const busy = h.addChannel({
      id: '8',
      type: ChannelType.GuildVoice,
      name: 'Squad Delta',
      parentId: CATEGORY,
    });
    h.setVoice(BOB, busy.id);

    await h.service.tick();
    expect(h.service.emptyRooms.size).toBe(1);

    h.advance(2 * MINUTE_MS);
    await h.service.tick();
    expect(empty.delete).toHaveBeenCalledOnce();
    expect(busy.delete).not.toHaveBeenCalled();
  });

  it('sala de jogatina nasce vazia com as vagas e fica de pé até o fim da reserva', async () => {
    const h = setup();
    const room = await h.service.openSessionRoom(h.guild, squadsConfig(), {
      slots: 6,
      members: null,
      until: 1_000_000 + 15 * MINUTE_MS,
    });
    expect(room).not.toBeNull();
    expect(h.guild.channels.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Squad Alfa', parent: CATEGORY, userLimit: 6 }),
    );
    expect(room!.permissionOverwrites.edit).not.toHaveBeenCalled();
    await h.service.tick(); // reconciliação: respeita a reserva

    h.advance(14 * MINUTE_MS);
    await h.service.tick();
    expect(room!.delete).not.toHaveBeenCalled();
    h.advance(MINUTE_MS);
    await h.service.tick();
    expect(room!.delete).toHaveBeenCalledOnce();
  });

  it('sala de jogatina que esvazia antes do fim da reserva espera a reserva', async () => {
    const h = setup();
    const room = (await h.service.openSessionRoom(h.guild, squadsConfig(), {
      slots: 4,
      members: null,
      until: 1_000_000 + 15 * MINUTE_MS,
    }))!;
    h.setVoice(ALICE, room.id);
    await h.service.onVoiceState(
      voiceState(h.guild, ALICE, null),
      voiceState(h.guild, ALICE, room.id),
    );
    h.advance(MINUTE_MS);
    h.setVoice(ALICE, null);
    await h.service.onVoiceState(
      voiceState(h.guild, ALICE, room.id),
      voiceState(h.guild, ALICE, null),
    );
    h.advance(3 * MINUTE_MS); // a janela normal (2 min) já passou
    await h.service.tick();
    expect(room.delete).not.toHaveBeenCalled();
    h.advance(11 * MINUTE_MS);
    await h.service.tick();
    expect(room.delete).toHaveBeenCalledOnce();
  });

  it('fechada: libera o bot e quem vai, depois nega o Connect ao @everyone', async () => {
    const h = setup();
    const room = (await h.service.openSessionRoom(h.guild, squadsConfig(), {
      slots: 4,
      members: [ALICE, BOB],
      until: 1_000_000,
    }))!;
    const { edit } = room.permissionOverwrites as unknown as { edit: ReturnType<typeof vi.fn> };
    const calls = edit.mock.calls.map((call) => [call[0], call[1]]);
    expect(calls).toEqual([
      ['bot', expect.objectContaining({ Connect: true, ManageChannels: true })],
      [ALICE, { Connect: true }],
      [BOB, { Connect: true }],
      [GUILD, { Connect: false }],
    ]);
  });

  it('fechada sem ManageRoles: a sala nasce aberta', async () => {
    const h = setup();
    h.denied.add(PermissionFlagsBits.ManageRoles);
    const room = await h.service.openSessionRoom(h.guild, squadsConfig(), {
      slots: 4,
      members: [ALICE],
      until: 1_000_000,
    });
    expect(room).not.toBeNull();
    expect(room!.permissionOverwrites.edit).not.toHaveBeenCalled();
  });

  it('sem categoria válida a jogatina fica sem sala', async () => {
    const h = setup();
    const room = await h.service.openSessionRoom(h.guild, squadsConfig({ categoryId: null }), {
      slots: 4,
      members: null,
      until: 1_000_000,
    });
    expect(room).toBeNull();
    expect(h.guild.channels.create).not.toHaveBeenCalled();
  });
});
