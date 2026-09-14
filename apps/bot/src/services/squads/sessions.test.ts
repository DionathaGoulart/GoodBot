import { DAY_MS, HOUR_MS, MINUTE_MS, WEEK_MS } from '@goodbot/shared';
import { OverwriteType, PermissionFlagsBits } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ALL_BUT_ADMIN,
  BOT_ID,
  componentsOf,
  embedOf,
  fakeTextChannel,
  fakeVoice,
  overwritesOf,
} from './__fixtures__/discord';
import { A, B, createHarness, NOW } from './__fixtures__/harness';
import { NO_RESERVED_VOICE_NOTE } from './embeds';
import { SQUAD_VOICE_MEMBER_BITS, squadTextOverwrites } from './overwrites';

import type { ExactOverwrite } from '../../lib/overwrites';

const fixtures = await vi.hoisted(async () => import('./__fixtures__/fake-db'));
vi.mock('@goodbot/db', () => fixtures.repositories);

const { store, repositories, seedGame, seedMember, seedSession, seedSquad, GUILD_ID } = fixtures;

const STAFF_ROLE = '700000000000000001';

/** O voice como estava antes de qualquer reserva. */
const BEFORE: ExactOverwrite[] = [
  {
    id: GUILD_ID,
    type: OverwriteType.Role,
    allow: PermissionFlagsBits.Connect | PermissionFlagsBits.Speak,
    deny: PermissionFlagsBits.Stream,
  },
  { id: STAFF_ROLE, type: OverwriteType.Role, allow: PermissionFlagsBits.MoveMembers, deny: 0n },
  { id: A, type: OverwriteType.Member, allow: 0n, deny: PermissionFlagsBits.Speak },
];

function scenario(options: { voicePermissions?: bigint } = {}) {
  const harness = createHarness();
  const voice = harness.guild.add(
    fakeVoice({ permissions: options.voicePermissions ?? ALL_BUT_ADMIN, overwrites: BEFORE }),
  );
  harness.setConfig({ voicePoolIds: [voice.id] });
  const game = seedGame({ squadSize: 4 });
  const channel = harness.guild.add(
    fakeTextChannel({
      overwrites: squadTextOverwrites({ everyoneId: GUILD_ID, botId: BOT_ID, memberIds: [A, B] }),
    }),
  );
  const squad = seedSquad({ gameId: game.id, textChannelId: channel.id, voiceChannelId: voice.id });
  seedMember(squad.id, A);
  seedMember(squad.id, B);
  const session = seedSession({
    squadId: squad.id,
    startsAt: new Date(NOW + 30 * MINUTE_MS),
    endsAt: new Date(NOW + 6 * HOUR_MS),
  });
  return { ...harness, voice, game, channel, squad, session };
}

const sessionRow = () => store.sessions[0]!;

describe('SquadService: sessões', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sem Connect no voice, a reserva devolve null sem tocar o Discord nem o banco', async () => {
    const s = scenario({ voicePermissions: ALL_BUT_ADMIN & ~PermissionFlagsBits.Connect });

    const voiceId = await s.service.reserveVoice(s.discordGuild, s.session);

    expect(voiceId).toBeNull();
    expect(s.voice.permissionOverwrites.set).not.toHaveBeenCalled();
    expect(repositories.reserveSessionVoice).not.toHaveBeenCalled();
    expect(sessionRow().voiceReservedAt).toBeNull();
  });

  it('a reserva tranca o voice e a liberação restaura o snapshot exato', async () => {
    const s = scenario();

    const voiceId = await s.service.reserveVoice(s.discordGuild, s.session);

    expect(voiceId).toBe(s.voice.id);
    const reserved = overwritesOf(s.voice.permissionOverwrites);
    const everyone = reserved.find((overwrite) => overwrite.id === GUILD_ID)!;
    expect(everyone.deny & PermissionFlagsBits.Connect).toBe(PermissionFlagsBits.Connect);
    expect(everyone.allow & PermissionFlagsBits.Speak).toBe(PermissionFlagsBits.Speak);
    expect(reserved.find((overwrite) => overwrite.id === B)?.allow).toBe(SQUAD_VOICE_MEMBER_BITS);
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'squad.voice.reserve', source: 'job' }),
    );

    // B sai do squad no meio da sessão: o overwrite dele também precisa sumir.
    store.members = store.members.filter((member) => member.userId !== B);
    const released = await s.service.releaseVoice(s.discordGuild, sessionRow());

    expect(released).toBe(true);
    expect(overwritesOf(s.voice.permissionOverwrites)).toEqual(BEFORE);
    expect(await s.service.releaseVoice(s.discordGuild, sessionRow())).toBe(false);
  });

  it('restore que falha não marca a liberação, e a próxima chamada tenta de novo', async () => {
    const s = scenario();
    await s.service.reserveVoice(s.discordGuild, s.session);
    s.voice.permissionOverwrites.set.mockRejectedValueOnce(new Error('503 Service Unavailable'));

    expect(await s.service.releaseVoice(s.discordGuild, sessionRow())).toBe(false);
    expect(sessionRow().voiceReleasedAt).toBeNull();
    expect(repositories.releaseSessionVoice).not.toHaveBeenCalled();
    expect(s.audit.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'squad.voice.release' }),
    );

    expect(await s.service.releaseVoice(s.discordGuild, sessionRow())).toBe(true);
    expect(sessionRow().voiceReleasedAt).not.toBeNull();
    expect(overwritesOf(s.voice.permissionOverwrites)).toEqual(BEFORE);
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'squad.voice.release' }),
    );
  });

  it('voice apagado: a liberação é marcada sem tocar o Discord', async () => {
    const s = scenario();
    await s.service.reserveVoice(s.discordGuild, s.session);
    s.voice.permissionOverwrites.set.mockClear();
    s.guild.channels.cache.delete(s.voice.id);

    expect(await s.service.releaseVoice(s.discordGuild, sessionRow())).toBe(true);
    expect(sessionRow().voiceReleasedAt).not.toBeNull();
    expect(s.voice.permissionOverwrites.set).not.toHaveBeenCalled();
  });

  it('falha ao buscar o voice (não é canal inexistente) deixa a reserva para a próxima passada', async () => {
    const s = scenario();
    await s.service.reserveVoice(s.discordGuild, s.session);
    s.guild.channels.cache.delete(s.voice.id);
    s.guild.channels.fetch.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 0 }));

    expect(await s.service.releaseVoice(s.discordGuild, sessionRow())).toBe(false);
    expect(sessionRow().voiceReleasedAt).toBeNull();
  });

  it('liberação bem-sucedida marca uma vez; a segunda chamada não chama o Discord', async () => {
    const s = scenario();
    await s.service.reserveVoice(s.discordGuild, s.session);
    s.voice.permissionOverwrites.set.mockClear();
    const stale = sessionRow();

    expect(await s.service.releaseVoice(s.discordGuild, stale)).toBe(true);
    expect(await s.service.releaseVoice(s.discordGuild, stale)).toBe(false);
    expect(s.voice.permissionOverwrites.set).toHaveBeenCalledTimes(1);
    expect(repositories.releaseSessionVoice).toHaveBeenCalledTimes(1);
  });

  it('voice segurado por outra reserva viva não é reservado de novo', async () => {
    const s = scenario();
    const other = seedSquad({ gameId: s.game.id });
    seedSession({
      squadId: other.id,
      voiceChannelId: s.voice.id,
      voiceReservedAt: new Date(NOW - HOUR_MS),
      voiceOverwrites: [],
    });

    expect(await s.service.reserveVoice(s.discordGuild, s.session)).toBeNull();
    expect(s.voice.permissionOverwrites.set).not.toHaveBeenCalled();
  });

  it('o lembrete sai uma vez só, com a sala e chamando os membros', async () => {
    const s = scenario();

    const first = await s.service.remindSession(s.discordGuild, s.session);
    const second = await s.service.remindSession(s.discordGuild, sessionRow());

    expect(first?.voiceChannelId).toBe(s.voice.id);
    expect(second).toBeNull();
    expect(s.channel.send).toHaveBeenCalledTimes(1);
    const message = s.channel.sent[0]!;
    expect(message.payload.content).toBe(`<@${A}> <@${B}>`);
    expect(componentsOf(message)).toHaveLength(1);
    expect(sessionRow().reminderMessageId).toBe(message.id);
  });

  it('sem sala, o lembrete manda usar qualquer voice livre', async () => {
    const s = scenario({ voicePermissions: ALL_BUT_ADMIN & ~PermissionFlagsBits.Connect });

    await s.service.remindSession(s.discordGuild, s.session);

    const field = embedOf(s.channel.sent[0])?.fields?.find((item) => item.name === 'Sala');
    expect(field?.value).toBe(NO_RESERVED_VOICE_NOTE);
  });

  it('o início move quem está em outro voice e chama quem não está, uma vez só', async () => {
    const s = scenario();
    const lobby = s.guild.add(fakeVoice());
    const stateA = s.guild.putInVoice(A, lobby.id);
    await s.service.reserveVoice(s.discordGuild, s.session);

    const first = await s.service.startSession(s.discordGuild, sessionRow());
    const second = await s.service.startSession(s.discordGuild, sessionRow());

    expect(first).toEqual({ moved: [A], pinged: [B] });
    expect(second).toBeNull();
    expect(stateA.setChannel).toHaveBeenCalledTimes(1);
    expect(stateA.setChannel).toHaveBeenCalledWith(s.voice.id, expect.any(String));
    expect(s.channel.sent.at(-1)?.payload.content).toContain(`<@${B}>`);
    expect(s.channel.sent.at(-1)?.payload.content).toContain(`<#${s.voice.id}>`);
  });

  it('"Vou" confirma o squad, zera o aviso e reedita a contagem', async () => {
    const s = scenario();
    await s.service.remindSession(s.discordGuild, s.session);
    store.squads[0]!.warnedAt = new Date(NOW - DAY_MS);

    const updated = await s.service.vote(s.discordGuild, s.session.id, A, true);

    expect(updated.goingIds).toEqual([A]);
    expect(store.squads[0]!.lastConfirmedAt).not.toBeNull();
    expect(store.squads[0]!.warnedAt).toBeNull();
    const going = embedOf(s.channel.sent[0])?.fields?.find((field) => field.name === 'Vão');
    expect(going?.value).toBe(`<@${A}>`);
  });

  it('inatividade avisa primeiro e arquiva depois de 7 dias sem resposta', async () => {
    const s = scenario();
    store.squads[0]!.createdAt = new Date(NOW - 5 * WEEK_MS);

    const warned = await s.service.checkInactivity(s.discordGuild);
    expect(warned).toEqual({ warned: [s.squad.id], archived: [] });
    expect(embedOf(s.channel.sent.at(-1))?.title).toBe('> O SQUAD AINDA JOGA?');

    s.clock.now = NOW + 3 * DAY_MS;
    expect(await s.service.checkInactivity(s.discordGuild)).toEqual({ warned: [], archived: [] });

    s.clock.now = NOW + 8 * DAY_MS;
    const archived = await s.service.checkInactivity(s.discordGuild);
    expect(archived).toEqual({ warned: [], archived: [s.squad.id] });
    expect(store.squads[0]!.status).toBe('archived');
  });
});
