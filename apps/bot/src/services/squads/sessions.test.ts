import { DAY_MS, HOUR_MS, MINUTE_MS, WEEK_MS } from '@goodbot/shared';
import { ChannelType, OverwriteType, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ALL_BUT_ADMIN,
  BOT_ID,
  componentsOf,
  discordError,
  embedOf,
  fakeTextChannel,
  fakeVoice,
  overwritesOf,
  snowflakeAt,
} from './__fixtures__/discord';
import { A, B, C, createHarness, D, NOW } from './__fixtures__/harness';
import { NO_RESERVED_VOICE_NOTE, TEMPORARY_VOICE_NOTE } from './embeds';
import {
  SQUAD_VOICE_MEMBER_BITS,
  squadTextOverwrites,
  temporaryVoiceOverwrites,
} from './overwrites';
import { TEMPORARY_VOICE_GRACE_MS } from './sessions';

import type { FakeMessage, FakeVoice } from './__fixtures__/discord';
import type { ExactOverwrite } from '../../lib/overwrites';
import type { APIActionRowComponent, APIButtonComponent } from 'discord.js';

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

/** Segunda, 14/09/2026, 21h em São Paulo. */
const TONIGHT = new Date('2026-09-15T00:00:00Z');

function scenario(
  options: { voicePermissions?: bigint; withSession?: boolean; partySize?: number } = {},
) {
  const harness = createHarness();
  const voice = harness.guild.add(
    fakeVoice({ permissions: options.voicePermissions ?? ALL_BUT_ADMIN, overwrites: BEFORE }),
  );
  harness.setConfig({ voicePoolIds: [voice.id] });
  const game = seedGame({ groupSize: 4, partySize: options.partySize ?? 4 });
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
    endsAt: new Date(NOW + 3 * HOUR_MS + 30 * MINUTE_MS),
  });
  return { ...harness, voice, game, channel, squad, session };
}

const sessionRow = () => store.sessions[0]!;
const squadRow = () => store.squads[0]!;

/** Rótulos dos botões de uma mensagem, na ordem. */
function buttonLabels(message: FakeMessage | undefined): string[] {
  return componentsOf(message).flatMap((row) =>
    (
      (row as { toJSON(): APIActionRowComponent<APIButtonComponent> }).toJSON().components as {
        label?: string;
      }[]
    ).map((button) => button.label ?? ''),
  );
}

/** A mensagem que o bot mandou com o id gravado. */
const messageById = (s: ReturnType<typeof scenario>, id: string | null | undefined) =>
  s.channel.sent.find((message) => message.id === id);

describe('SquadService: reserva e liberação do voice', () => {
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

    // B sai do squad no meio da jogatina: o overwrite dele também precisa sumir.
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
    // Com o voice temporário desligado, pool cheio é jogatina sem sala.
    s.setConfig({ temporaryVoices: false });
    fillPool(s);

    expect(await s.service.reserveVoice(s.discordGuild, s.session)).toBeNull();
    expect(s.voice.permissionOverwrites.set).not.toHaveBeenCalled();
    expect(s.guild.channels.create).not.toHaveBeenCalled();
  });
});

/** Outra jogatina viva segurando o único voice do pool do cenário. */
function fillPool(s: ReturnType<typeof scenario>): void {
  const other = seedSquad({ gameId: s.game.id });
  seedSession({
    squadId: other.id,
    voiceChannelId: s.voice.id,
    voiceReservedAt: new Date(NOW - HOUR_MS),
    voiceOverwrites: [],
  });
}

/** Cenário com o pool cheio e o voice temporário já criado para a jogatina. */
async function withTemporaryVoice() {
  const s = scenario();
  fillPool(s);
  const voiceId = await s.service.reserveVoice(s.discordGuild, s.session);
  const temporary = s.guild.channels.cache.get(voiceId ?? '') as FakeVoice | undefined;
  return { ...s, voiceId, temporary: temporary! };
}

describe('SquadService: voice temporário com o pool cheio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cria um voice trancado na categoria dos squads e grava a reserva como temporária', async () => {
    const s = await withTemporaryVoice();

    expect(s.voiceId).not.toBeNull();
    expect(s.voiceId).not.toBe(s.voice.id);
    expect(s.guild.channels.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ChannelType.GuildVoice,
        parent: s.category.id,
        name: 'Jogatina · Squad Teste',
      }),
    );
    const overwrites = overwritesOf(s.temporary.permissionOverwrites);
    const everyone = overwrites.find((overwrite) => overwrite.id === GUILD_ID)!;
    expect(everyone.deny & PermissionFlagsBits.Connect).toBe(PermissionFlagsBits.Connect);
    expect(overwrites.find((overwrite) => overwrite.id === A)?.allow).toBe(SQUAD_VOICE_MEMBER_BITS);
    const bot = overwrites.find((overwrite) => overwrite.id === BOT_ID)!;
    expect(bot.allow & PermissionFlagsBits.ManageChannels).toBe(PermissionFlagsBits.ManageChannels);

    expect(sessionRow()).toMatchObject({
      voiceChannelId: s.voiceId,
      voiceTemporary: true,
      voiceOverwrites: null,
    });
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'squad.voice.reserve',
        after: expect.objectContaining({ temporary: true }),
      }),
    );
    expect(await s.service.isTemporaryVoice(GUILD_ID, s.voiceId!)).toBe(true);
    expect(await s.service.isTemporaryVoice(GUILD_ID, s.voice.id)).toBe(false);
  });

  it('a liberação apaga o voice em vez de restaurar overwrites', async () => {
    const s = await withTemporaryVoice();

    expect(await s.service.releaseVoice(s.discordGuild, sessionRow())).toBe(true);

    expect(s.temporary.delete).toHaveBeenCalledOnce();
    expect(s.guild.channels.cache.has(s.voiceId!)).toBe(false);
    expect(sessionRow().voiceReleasedAt).not.toBeNull();
    expect(await s.service.isTemporaryVoice(GUILD_ID, s.voiceId!)).toBe(false);
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'squad.voice.release',
        after: expect.objectContaining({ temporary: true }),
      }),
    );
  });

  it('com gente dentro o voice fica de pé; esvaziou, a próxima liberação apaga', async () => {
    const s = await withTemporaryVoice();
    s.temporary.members.set(A, { id: A, user: { bot: false } });

    expect(await s.service.releaseVoice(s.discordGuild, sessionRow())).toBe(false);
    expect(s.temporary.delete).not.toHaveBeenCalled();
    expect(sessionRow().voiceReleasedAt).toBeNull();

    s.temporary.members.delete(A);
    expect(await s.service.releaseVoice(s.discordGuild, sessionRow())).toBe(true);
    expect(s.temporary.delete).toHaveBeenCalledOnce();
  });

  it('apagar que falha fica para a próxima passada; canal que já sumiu marca a liberação', async () => {
    const s = await withTemporaryVoice();
    s.temporary.delete.mockRejectedValueOnce(discordError('503 Service Unavailable', 0));

    expect(await s.service.releaseVoice(s.discordGuild, sessionRow())).toBe(false);
    expect(sessionRow().voiceReleasedAt).toBeNull();

    s.temporary.delete.mockRejectedValueOnce(discordError('Unknown Channel', 10003));
    expect(await s.service.releaseVoice(s.discordGuild, sessionRow())).toBe(true);
    expect(sessionRow().voiceReleasedAt).not.toBeNull();
  });

  it('sem permissão para criar na categoria, a jogatina fica sem sala', async () => {
    const s = scenario();
    fillPool(s);
    s.category.permissionsFor.mockReturnValue(
      new PermissionsBitField(ALL_BUT_ADMIN & ~PermissionFlagsBits.ManageChannels),
    );

    expect(await s.service.reserveVoice(s.discordGuild, s.session)).toBeNull();
    expect(s.guild.channels.create).not.toHaveBeenCalled();
    expect(sessionRow().voiceReservedAt).toBeNull();
  });

  it('a reserva é gravada antes de pedir o canal', async () => {
    const s = scenario();
    fillPool(s);
    // Foto da linha no instante em que o Discord é chamado. O `expect` fica do
    // lado de fora: dentro do mock, o `catch` do service engoliria a falha.
    let atCreate: { voiceTemporary: boolean; reserved: boolean } | null = null;
    s.guild.channels.create.mockImplementationOnce(async () => {
      atCreate = {
        voiceTemporary: sessionRow().voiceTemporary,
        reserved: sessionRow().voiceReservedAt !== null,
      };
      throw discordError('Missing Permissions', 50013);
    });

    await s.service.reserveVoice(s.discordGuild, s.session);
    expect(atCreate).toEqual({ voiceTemporary: true, reserved: true });
  });

  it('o Discord recusa (teto de 500 canais): a reserva vira sem sala na hora', async () => {
    const s = scenario();
    fillPool(s);
    s.guild.channels.create.mockRejectedValueOnce(
      discordError('Maximum number of guild channels reached (500)', 30013),
    );

    expect(await s.service.reserveVoice(s.discordGuild, s.session)).toBeNull();
    expect(sessionRow().voiceReleasedAt).not.toBeNull();
  });

  it('o Discord não responde: a reserva fica pendente para a reconciliação', async () => {
    const s = scenario();
    fillPool(s);
    s.guild.channels.create.mockRejectedValueOnce(new Error('Request aborted'));

    expect(await s.service.reserveVoice(s.discordGuild, s.session)).toBeNull();
    expect(sessionRow()).toMatchObject({ voiceTemporary: true, voiceChannelId: null });
    expect(sessionRow().voiceReleasedAt).toBeNull();
  });

  it('a reserva que perde a corrida nem chega a criar canal', async () => {
    const s = scenario();
    fillPool(s);
    repositories.reserveSessionVoice.mockResolvedValueOnce(null);

    expect(await s.service.reserveVoice(s.discordGuild, s.session)).toBeNull();
    expect(s.guild.channels.create).not.toHaveBeenCalled();
  });

  it('reserva liberada enquanto o canal nascia: o canal novo é apagado', async () => {
    const s = scenario();
    fillPool(s);
    repositories.setSessionTemporaryVoice.mockResolvedValueOnce(null);

    expect(await s.service.reserveVoice(s.discordGuild, s.session)).toBeNull();
    const created = await (s.guild.channels.create.mock.results[0]?.value as Promise<FakeVoice>);
    expect(created.delete).toHaveBeenCalledOnce();
  });

  it('depois de um reinício o voice temporário ainda é reconhecido, pelo banco', async () => {
    const s = scenario();
    fillPool(s);
    // A primeira pergunta carrega a lista (vazia); a criação entra nela sem reler.
    expect(await s.service.isTemporaryVoice(GUILD_ID, s.voice.id)).toBe(false);
    const voiceId = (await s.service.reserveVoice(s.discordGuild, s.session))!;
    expect(await s.service.isTemporaryVoice(GUILD_ID, voiceId)).toBe(true);
    expect(repositories.listLiveTemporaryVoiceIds).toHaveBeenCalledTimes(1);

    (
      s.parts.sessions as unknown as { temporaryVoices: Map<string, Set<string>> }
    ).temporaryVoices.clear();
    expect(await s.service.isTemporaryVoice(GUILD_ID, voiceId)).toBe(true);
    expect(repositories.listLiveTemporaryVoiceIds).toHaveBeenCalledTimes(2);
  });

  it('o lembrete e a mensagem da jogatina avisam que a sala some', async () => {
    const s = scenario();
    fillPool(s);
    store.sessions = store.sessions.filter((session) => session.id !== s.session.id);
    await s.service.scheduleSession(s.discordGuild, s.squad.id, A, 'hoje 21h', 'command');
    const session = store.sessions.find((row) => row.squadId === s.squad.id)!;
    s.clock.now = TONIGHT.getTime() - 20 * MINUTE_MS;

    await s.service.remindSession(s.discordGuild, session);

    const reminded = store.sessions.find((row) => row.id === session.id)!;
    const note = `<#${String(reminded.voiceChannelId)}>, ${TEMPORARY_VOICE_NOTE}.`;
    expect(s.channel.sent.at(-1)?.payload.content).toContain(note);
    const room = embedOf(messageById(s, reminded.messageId))?.fields?.find(
      (field) => field.name === 'Sala',
    );
    expect(room?.value).toBe(note);
  });
});

describe('SquadService: quem entra no squad com a reserva viva', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const join = (s: ReturnType<typeof scenario>, userId: string) =>
    s.parts.squads.addMember(s.discordGuild, s.squad.id, userId, { source: 'event', ping: true });
  const overwriteOf = (voice: FakeVoice, id: string) =>
    overwritesOf(voice.permissionOverwrites).find((overwrite) => overwrite.id === id);

  it('ganha o voice do pool, e a liberação o devolve ao que era, mesmo saindo e voltando', async () => {
    const s = scenario();
    await s.voice.permissionOverwrites.edit(C, { Stream: false }, { type: OverwriteType.Member });
    s.voice.permissionOverwrites.edit.mockClear();
    const original = overwritesOf(s.voice.permissionOverwrites);
    await s.service.reserveVoice(s.discordGuild, s.session);

    await join(s, C);

    expect(overwriteOf(s.voice, C)).toEqual({
      id: C,
      type: OverwriteType.Member,
      allow: SQUAD_VOICE_MEMBER_BITS,
      deny: PermissionFlagsBits.Stream,
    });
    // O snapshot vem antes da concessão: sem ele, a liberação não devolveria o id.
    const [appendOrder] = repositories.appendSessionVoiceSnapshot.mock.invocationCallOrder;
    const [grantOrder] = s.voice.permissionOverwrites.edit.mock.invocationCallOrder;
    expect(appendOrder).toBeLessThan(grantOrder!);
    expect(sessionRow().voiceOverwrites).toContainEqual({
      id: C,
      type: OverwriteType.Member,
      allow: '0',
      deny: PermissionFlagsBits.Stream.toString(),
    });

    // Sair e voltar com a mesma reserva não troca o que o snapshot guardou.
    await s.parts.squads.removeMember(s.discordGuild, s.squad.id, C, null);
    await join(s, C);
    expect(sessionRow().voiceOverwrites?.filter((overwrite) => overwrite.id === C)).toHaveLength(1);

    expect(await s.service.releaseVoice(s.discordGuild, sessionRow())).toBe(true);
    expect(overwritesOf(s.voice.permissionOverwrites)).toEqual(original);
  });

  it('no voice temporário só concede: ele é apagado no fim e não tem snapshot', async () => {
    const s = await withTemporaryVoice();

    await join(s, C);

    expect(overwriteOf(s.temporary, C)?.allow).toBe(SQUAD_VOICE_MEMBER_BITS);
    expect(repositories.appendSessionVoiceSnapshot).not.toHaveBeenCalled();
    expect(sessionRow().voiceOverwrites).toBeNull();
  });

  it('a reserva de outro squad no mesmo voice não concede', async () => {
    const s = scenario();
    fillPool(s);

    await join(s, C);

    expect(s.voice.permissionOverwrites.edit).not.toHaveBeenCalled();
    expect(repositories.appendSessionVoiceSnapshot).not.toHaveBeenCalled();
  });

  it('jogatina cancelada ou sala já devolvida não concede', async () => {
    const s = scenario();
    await s.service.reserveVoice(s.discordGuild, s.session);
    // Cancelada com a liberação ainda pendente: a sala está voltando ao pool.
    sessionRow().cancelledAt = new Date(NOW);
    await join(s, C);
    expect(overwriteOf(s.voice, C)).toBeUndefined();

    sessionRow().cancelledAt = null;
    await s.service.releaseVoice(s.discordGuild, sessionRow());
    await join(s, D);
    expect(overwriteOf(s.voice, D)).toBeUndefined();
  });

  it('liberada entre a leitura das reservas e o snapshot: não concede', async () => {
    const s = scenario();
    await s.service.reserveVoice(s.discordGuild, s.session);
    repositories.appendSessionVoiceSnapshot.mockResolvedValueOnce(null);

    await join(s, C);

    expect(overwriteOf(s.voice, C)).toBeUndefined();
  });

  it('o Discord recusando a concessão não derruba a entrada no squad', async () => {
    const s = scenario();
    await s.service.reserveVoice(s.discordGuild, s.session);
    s.voice.permissionOverwrites.edit.mockRejectedValueOnce(
      discordError('Missing Permissions', 50013),
    );

    const { joined } = await join(s, C);

    expect(joined).toBe(true);
    expect(store.members.some((member) => member.userId === C)).toBe(true);
    expect(overwriteOf(s.voice, C)).toBeUndefined();
  });
});

/**
 * Cenário de uma criação interrompida: o canal nasceu no Discord, mas o id não
 * chegou ao banco (o bot caiu ou o banco falhou entre as duas escritas).
 */
async function interruptedCreation() {
  const s = scenario();
  fillPool(s);
  repositories.setSessionTemporaryVoice.mockRejectedValueOnce(new Error('connection terminated'));
  expect(await s.service.reserveVoice(s.discordGuild, s.session)).toBeNull();
  const orphan = await (s.guild.channels.create.mock.results[0]?.value as Promise<FakeVoice>);
  expect(sessionRow()).toMatchObject({ voiceTemporary: true, voiceChannelId: null });
  return { ...s, orphan };
}

describe('SquadService: reconciliação do voice temporário', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dentro da carência não mexe em nada: a criação pode estar em curso', async () => {
    const s = await interruptedCreation();
    s.clock.now += TEMPORARY_VOICE_GRACE_MS - 1;

    expect(await s.service.reconcileTemporaryVoices(s.discordGuild)).toBe(0);
    expect(sessionRow().voiceChannelId).toBeNull();
    expect(s.orphan.delete).not.toHaveBeenCalled();
  });

  it('jogatina ainda valendo: adota o canal órfão', async () => {
    const s = await interruptedCreation();
    s.clock.now += TEMPORARY_VOICE_GRACE_MS;

    expect(await s.service.reconcileTemporaryVoices(s.discordGuild)).toBe(1);

    expect(sessionRow().voiceChannelId).toBe(s.orphan.id);
    expect(s.orphan.delete).not.toHaveBeenCalled();
    expect(await s.service.isTemporaryVoice(GUILD_ID, s.orphan.id)).toBe(true);
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'squad.voice.reserve',
        after: expect.objectContaining({ recovered: true }),
      }),
    );
    // Adotado, é um voice temporário como outro qualquer: a liberação apaga.
    expect(await s.service.releaseVoice(s.discordGuild, sessionRow())).toBe(true);
    expect(s.orphan.delete).toHaveBeenCalledOnce();
    // E a segunda passada não acha mais nada para resolver.
    expect(await s.service.reconcileTemporaryVoices(s.discordGuild)).toBe(0);
  });

  it('jogatina que já acabou: apaga o órfão e libera a reserva', async () => {
    const s = await interruptedCreation();
    s.clock.now = sessionRow().endsAt.getTime() + MINUTE_MS;

    expect(await s.service.reconcileTemporaryVoices(s.discordGuild)).toBe(1);

    expect(s.orphan.delete).toHaveBeenCalledOnce();
    expect(s.guild.channels.cache.has(s.orphan.id)).toBe(false);
    expect(sessionRow().voiceReleasedAt).not.toBeNull();
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'squad.voice.release',
        after: expect.objectContaining({ orphan: true }),
      }),
    );
  });

  it('órfão com gente dentro espera esvaziar', async () => {
    const s = await interruptedCreation();
    s.clock.now = sessionRow().endsAt.getTime() + MINUTE_MS;
    s.orphan.members.set(A, { id: A, user: { bot: false } });

    expect(await s.service.reconcileTemporaryVoices(s.discordGuild)).toBe(0);
    expect(s.orphan.delete).not.toHaveBeenCalled();

    s.orphan.members.delete(A);
    expect(await s.service.reconcileTemporaryVoices(s.discordGuild)).toBe(1);
    expect(s.orphan.delete).toHaveBeenCalledOnce();
  });

  it('o canal nunca nasceu: a reserva vira sem sala', async () => {
    const s = scenario();
    fillPool(s);
    s.guild.channels.create.mockRejectedValueOnce(new Error('Request aborted'));
    await s.service.reserveVoice(s.discordGuild, s.session);
    s.clock.now += TEMPORARY_VOICE_GRACE_MS;

    expect(await s.service.reconcileTemporaryVoices(s.discordGuild)).toBe(1);
    expect(sessionRow().voiceReleasedAt).not.toBeNull();
    expect(await s.service.reconcileTemporaryVoices(s.discordGuild)).toBe(0);
  });

  it('não confunde com voice feito à mão: sem a assinatura, ou criado fora da janela', async () => {
    const s = scenario();
    fillPool(s);
    s.guild.channels.create.mockRejectedValueOnce(new Error('Request aborted'));
    await s.service.reserveVoice(s.discordGuild, s.session);
    const reservedAt = sessionRow().voiceReservedAt!.getTime();
    // Mesmo nome e mesma hora, mas sem os overwrites que só o bot escreve.
    const handmade = s.guild.add(
      fakeVoice({ id: snowflakeAt(reservedAt + 1000), name: 'Jogatina · Squad Teste' }),
    );
    // Com a assinatura, mas criado muito depois da reserva.
    const late = s.guild.add(
      fakeVoice({
        id: snowflakeAt(reservedAt + TEMPORARY_VOICE_GRACE_MS + 60_000),
        overwrites: temporaryVoiceOverwrites({
          everyoneId: GUILD_ID,
          botId: BOT_ID,
          memberIds: [A],
        }),
      }),
    );
    s.clock.now = sessionRow().endsAt.getTime() + MINUTE_MS;

    await s.service.reconcileTemporaryVoices(s.discordGuild);

    expect(handmade.delete).not.toHaveBeenCalled();
    expect(late.delete).not.toHaveBeenCalled();
    expect(s.guild.channels.cache.has(handmade.id)).toBe(true);
    expect(s.guild.channels.cache.has(late.id)).toBe(true);
  });
});

describe('SquadService: marcar jogatina', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hoje 21h: grava quem marcou como vou, anuncia chamando o squad e atualiza o guia', async () => {
    const s = scenario();
    store.sessions = [];

    const result = await s.service.scheduleSession(
      s.discordGuild,
      s.squad.id,
      A,
      'hoje 21h',
      'command',
    );

    expect(result.outcome).toBe('created');
    expect(sessionRow()).toMatchObject({
      startsAt: TONIGHT,
      endsAt: new Date(TONIGHT.getTime() + 3 * HOUR_MS),
      createdBy: A,
      goingIds: [A],
      remindedAt: null,
      voiceReservedAt: null,
    });
    const announce = messageById(s, sessionRow().messageId)!;
    expect(announce.payload.content).toBe(`<@${A}> <@${B}>`);
    expect(embedOf(announce)?.title).toBe('> JOGATINA MARCADA');
    expect(buttonLabels(announce)).toEqual([
      'VOU',
      'NÃO VOU',
      'CHAMAR GENTE',
      'TRAZER CONVIDADO',
      'REMARCAR',
      'CANCELAR',
    ]);
    expect(squadRow().lastConfirmedAt).not.toBeNull();
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'squad.session.schedule', source: 'command', actor: A }),
    );

    const guide = messageById(s, squadRow().guideMessageId)!;
    const next = embedOf(guide)?.fields?.find((field) => field.name === 'Próximas jogatinas');
    expect(next?.value).toContain('1 vai');
    expect(s.voice.permissionOverwrites.set).not.toHaveBeenCalled();
  });

  it('agora: reserva a sala, começa na hora e puxa quem está em outro voice', async () => {
    const s = scenario();
    store.sessions = [];
    const lobby = s.guild.add(fakeVoice());
    const stateB = s.guild.putInVoice(B, lobby.id);

    await s.service.scheduleSession(s.discordGuild, s.squad.id, A, 'agora', 'event');

    expect(sessionRow()).toMatchObject({ voiceChannelId: s.voice.id });
    expect(sessionRow().remindedAt).not.toBeNull();
    expect(sessionRow().startedAt).not.toBeNull();
    expect(stateB.setChannel).toHaveBeenCalledWith(s.voice.id, expect.any(String));
    const announce = messageById(s, sessionRow().messageId)!;
    expect(embedOf(announce)?.title).toBe('> JOGATINA COMEÇOU');
    expect(buttonLabels(announce)).toEqual(['REPETIR', 'TRAZER CONVIDADO']);
    // Anúncio já chamou todo mundo: não sai lembrete à parte.
    expect(
      s.channel.sent.some((message) => String(message.payload.content).includes('começa')),
    ).toBe(false);
  });

  it('o mesmo minuto duas vezes vira uma jogatina, e quem pediu de novo passa a ir', async () => {
    const s = scenario();
    store.sessions = [];
    await s.service.scheduleSession(s.discordGuild, s.squad.id, A, 'hoje 21h', 'command');

    const again = await s.service.scheduleSession(
      s.discordGuild,
      s.squad.id,
      B,
      'hoje 21:00',
      'event',
    );

    expect(again.outcome).toBe('exists');
    expect(store.sessions).toHaveLength(1);
    expect(sessionRow().goingIds).toEqual([A, B]);
  });

  it('recusa quem não é do squad, texto que não entende e o teto de jogatinas', async () => {
    const s = scenario();
    store.sessions = [];

    await expect(
      s.service.scheduleSession(s.discordGuild, s.squad.id, C, 'hoje 21h', 'command'),
    ).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
    await expect(
      s.service.scheduleSession(s.discordGuild, s.squad.id, A, 'quando der', 'command'),
    ).rejects.toMatchObject({ code: 'INVALID_WHEN' });

    s.setConfig({ maxUpcomingSessions: 1 });
    await s.service.scheduleSession(s.discordGuild, s.squad.id, A, 'hoje 21h', 'command');
    await expect(
      s.service.scheduleSession(s.discordGuild, s.squad.id, A, 'amanhã 21h', 'command'),
    ).rejects.toMatchObject({ code: 'SESSION_LIMIT' });
  });

  it('squad arquivado não marca', async () => {
    const s = scenario();
    squadRow().status = 'archived';

    await expect(
      s.service.scheduleSession(s.discordGuild, s.squad.id, A, 'hoje 21h', 'command'),
    ).rejects.toMatchObject({ code: 'SQUAD_ARCHIVED' });
  });
});

describe('SquadService: cancelar e repetir', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function scheduled(by = A, when = 'hoje 21h') {
    const s = scenario();
    store.sessions = [];
    const { session } = await s.service.scheduleSession(
      s.discordGuild,
      s.squad.id,
      by,
      when,
      'command',
    );
    return { ...s, session };
  }

  it('quem marcou cancela: sem botões, guia sem a jogatina e segundo clique inofensivo', async () => {
    const s = await scheduled();

    const result = await s.service.cancelSession(s.discordGuild, s.session.id, A, 'event');

    expect(result.outcome).toBe('cancelled');
    expect(sessionRow()).toMatchObject({ cancelledBy: A });
    const announce = messageById(s, sessionRow().messageId)!;
    expect(embedOf(announce)?.title).toBe('> JOGATINA CANCELADA');
    expect(componentsOf(announce)).toEqual([]);
    const guide = embedOf(messageById(s, squadRow().guideMessageId));
    expect(guide?.fields?.find((field) => field.name === 'Próximas jogatinas')?.value).toContain(
      'Nenhuma marcada',
    );
    expect((await s.service.cancelSession(s.discordGuild, s.session.id, A, 'event')).outcome).toBe(
      'already',
    );
    await expect(s.service.vote(s.discordGuild, s.session.id, B, true)).rejects.toMatchObject({
      code: 'SESSION_CANCELLED',
    });
  });

  it('outro membro só cancela enquanto ninguém além dele confirmou', async () => {
    const s = await scheduled();

    await expect(
      s.service.cancelSession(s.discordGuild, s.session.id, B, 'event'),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_OWNER' });

    await s.service.vote(s.discordGuild, s.session.id, A, false);
    expect((await s.service.cancelSession(s.discordGuild, s.session.id, B, 'event')).outcome).toBe(
      'cancelled',
    );
  });

  it('cancelar devolve a sala reservada, e marcar de novo no mesmo minuto reabre a linha', async () => {
    const s = await scheduled(A, 'hoje 9h20');
    expect(sessionRow().voiceReservedAt).not.toBeNull();

    await s.service.cancelSession(s.discordGuild, s.session.id, A, 'event');
    expect(overwritesOf(s.voice.permissionOverwrites)).toEqual(BEFORE);
    expect(sessionRow().voiceReleasedAt).not.toBeNull();

    const again = await s.service.scheduleSession(
      s.discordGuild,
      s.squad.id,
      B,
      'hoje 9h20',
      'event',
    );
    expect(again.outcome).toBe('created');
    expect(store.sessions).toHaveLength(1);
    expect(sessionRow()).toMatchObject({ id: s.session.id, cancelledAt: null, createdBy: B });
    expect(sessionRow().voiceChannelId).toBe(s.voice.id);
  });

  it('jogatina que já começou não cancela', async () => {
    const s = await scheduled(A, 'agora');

    await expect(
      s.service.cancelSession(s.discordGuild, s.session.id, A, 'event'),
    ).rejects.toMatchObject({ code: 'SESSION_STARTED' });
  });

  it('REPETIR marca a mesma hora na semana seguinte, mesmo clicado semanas depois', async () => {
    const s = await scheduled();

    const next = await s.service.repeatSession(s.discordGuild, s.session.id, B, 'event');
    expect(next.session.startsAt).toEqual(new Date(TONIGHT.getTime() + WEEK_MS));
    expect(next.session.createdBy).toBe(B);

    s.clock.now = NOW + 3 * WEEK_MS;
    const late = await s.service.repeatSession(s.discordGuild, s.session.id, A, 'event');
    expect(late.session.startsAt).toEqual(new Date(TONIGHT.getTime() + 3 * WEEK_MS));
  });
});

describe('SquadService: remarcar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const unix = (ms: number) => String(ms / 1000);

  async function scheduled(by = A, when = 'hoje 21h') {
    const s = scenario();
    store.sessions = [];
    const { session } = await s.service.scheduleSession(
      s.discordGuild,
      s.squad.id,
      by,
      when,
      'command',
    );
    return { ...s, session };
  }

  it('adiar: horário e fim novos, votos ficam, o squad inteiro é chamado e o guia acompanha', async () => {
    const s = await scheduled();
    await s.service.vote(s.discordGuild, s.session.id, B, false);

    const result = await s.service.rescheduleSession(
      s.discordGuild,
      s.session.id,
      A,
      'hoje 22h',
      'event',
    );

    const later = TONIGHT.getTime() + HOUR_MS;
    expect(result).toMatchObject({ outcome: 'rescheduled', from: TONIGHT });
    expect(sessionRow()).toMatchObject({
      startsAt: new Date(later),
      endsAt: new Date(later + 3 * HOUR_MS),
      goingIds: [A],
      notGoingIds: [B],
      remindedAt: null,
    });
    // Quem disse NÃO VOU para as 21h é chamado: pode poder às 22h. Quem remarcou, não.
    const notice = s.channel.sent.at(-1)!;
    expect(notice.payload.content).toContain(
      `<@${B}> a jogatina do squad foi remarcada por <@${A}>`,
    );
    expect(notice.payload.allowedMentions).toEqual({ users: [B] });
    expect(notice.payload.content).toContain(`<t:${unix(later)}:f>`);
    expect(s.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'squad.session.reschedule',
        actor: A,
        before: expect.objectContaining({ startsAt: TONIGHT.toISOString() }),
        after: expect.objectContaining({ startsAt: new Date(later).toISOString() }),
      }),
    );
    const announce = embedOf(messageById(s, sessionRow().messageId));
    expect(announce?.description).toContain(`<t:${unix(later)}:F>`);
    const guide = embedOf(messageById(s, squadRow().guideMessageId));
    expect(guide?.fields?.find((field) => field.name === 'Próximas jogatinas')?.value).toContain(
      `<t:${unix(later)}:f>`,
    );
  });

  it('com a sala reservada, adiar para longe devolve a sala e o job reserva de novo perto da hora', async () => {
    const s = await scheduled(A, 'hoje 9h20');
    expect(sessionRow().voiceChannelId).toBe(s.voice.id);

    await s.service.rescheduleSession(s.discordGuild, s.session.id, A, 'hoje 21h', 'event');

    expect(overwritesOf(s.voice.permissionOverwrites)).toEqual(BEFORE);
    expect(sessionRow()).toMatchObject({
      startsAt: TONIGHT,
      remindedAt: null,
      voiceChannelId: null,
      voiceReservedAt: null,
      voiceReleasedAt: null,
    });
    const room = embedOf(messageById(s, sessionRow().messageId))?.fields?.find(
      (field) => field.name === 'Sala',
    );
    expect(room?.value).toBe('Reservo uma sala 30 minutos antes.');

    s.clock.now = TONIGHT.getTime() - 20 * MINUTE_MS;
    const due = await s.service.dueSessions(GUILD_ID);
    expect(due.remind.map((session) => session.id)).toEqual([s.session.id]);
    expect((await s.service.remindSession(s.discordGuild, sessionRow()))?.voiceChannelId).toBe(
      s.voice.id,
    );
  });

  it('sala que não volta ao pool deixa a jogatina no horário antigo', async () => {
    const s = await scheduled(A, 'hoje 9h20');
    const before = sessionRow().startsAt;
    s.voice.permissionOverwrites.set.mockRejectedValueOnce(new Error('503 Service Unavailable'));

    await expect(
      s.service.rescheduleSession(s.discordGuild, s.session.id, A, 'hoje 21h', 'event'),
    ).rejects.toMatchObject({ code: 'SESSION_VOICE_BUSY' });
    expect(sessionRow().startsAt).toEqual(before);
    expect(sessionRow().voiceReleasedAt).toBeNull();
    expect(s.audit.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'squad.session.reschedule' }),
    );
  });

  it('voice temporário ainda nascendo segura a remarcação para a reconciliação não perder o rastro', async () => {
    const s = scenario();
    fillPool(s);
    store.sessions = store.sessions.filter((session) => session.id !== s.session.id);
    s.guild.channels.create.mockRejectedValueOnce(new Error('Request aborted'));
    const { session } = await s.service.scheduleSession(
      s.discordGuild,
      s.squad.id,
      A,
      'hoje 9h20',
      'command',
    );
    const pending = () => store.sessions.find((row) => row.id === session.id)!;
    expect(pending()).toMatchObject({ voiceTemporary: true, voiceChannelId: null });

    await expect(
      s.service.rescheduleSession(s.discordGuild, session.id, A, 'hoje 21h', 'event'),
    ).rejects.toMatchObject({ code: 'SESSION_VOICE_BUSY' });
    expect(pending().startsAt).toEqual(session.startsAt);
    expect(pending().voiceReservedAt).not.toBeNull();
    expect(pending().voiceReleasedAt).toBeNull();
  });

  it('adiantar para dentro da antecedência reserva na hora, sem lembrete à parte', async () => {
    const s = await scheduled();

    await s.service.rescheduleSession(s.discordGuild, s.session.id, A, 'hoje 9h20', 'event');

    expect(sessionRow().voiceChannelId).toBe(s.voice.id);
    expect(sessionRow().remindedAt).not.toBeNull();
    const notice = s.channel.sent.at(-1)!;
    expect(notice.payload.content).toContain(`A sala é <#${s.voice.id}>.`);
    expect(
      s.channel.sent.some((message) => String(message.payload.content).includes('squad começa')),
    ).toBe(false);
  });

  it('agora: começa, puxa quem está em outro voice, e o aviso chama só quem tinha recusado', async () => {
    const s = await scheduled();
    seedMember(s.squad.id, C);
    await s.service.vote(s.discordGuild, s.session.id, C, false);
    const lobby = s.guild.add(fakeVoice());
    const stateB = s.guild.putInVoice(B, lobby.id);

    const result = await s.service.rescheduleSession(
      s.discordGuild,
      s.session.id,
      A,
      'agora',
      'event',
    );

    expect(result.session.startedAt).not.toBeNull();
    expect(stateB.setChannel).toHaveBeenCalledWith(s.voice.id, expect.any(String));
    const notice = s.channel.sent.find((message) =>
      String(message.payload.content).includes('foi remarcada'),
    )!;
    expect(notice.payload.content).toContain('começa agora');
    expect(notice.payload.allowedMentions).toEqual({ users: [C] });
    expect(embedOf(messageById(s, sessionRow().messageId))?.title).toBe('> JOGATINA COMEÇOU');
  });

  it('só quem está no VOU remarca, e só antes do início', async () => {
    const s = await scheduled();
    const reschedule = (by: string, when = 'hoje 22h') =>
      s.service.rescheduleSession(s.discordGuild, s.session.id, by, when, 'event');

    await expect(reschedule(B)).rejects.toMatchObject({ code: 'SESSION_NOT_GOING' });
    await expect(s.service.rescheduleForm(s.discordGuild, s.session.id, B)).rejects.toMatchObject({
      code: 'SESSION_NOT_GOING',
    });
    await expect(reschedule(C)).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });

    // Quem marcou e trocou para NÃO VOU perde o direito; quem passou a ir ganha.
    await s.service.vote(s.discordGuild, s.session.id, A, false);
    await expect(reschedule(A)).rejects.toMatchObject({ code: 'SESSION_NOT_GOING' });
    await s.service.vote(s.discordGuild, s.session.id, B, true);
    expect((await reschedule(B)).outcome).toBe('rescheduled');

    const started = await scheduled(A, 'agora');
    await expect(
      started.service.rescheduleSession(
        started.discordGuild,
        started.session.id,
        A,
        'hoje 22h',
        'event',
      ),
    ).rejects.toMatchObject({ code: 'SESSION_STARTED' });

    const cancelled = await scheduled();
    await cancelled.service.cancelSession(cancelled.discordGuild, cancelled.session.id, A, 'event');
    await expect(
      cancelled.service.rescheduleSession(
        cancelled.discordGuild,
        cancelled.session.id,
        A,
        'hoje 22h',
        'event',
      ),
    ).rejects.toMatchObject({ code: 'SESSION_CANCELLED' });
  });

  it('minuto de outra jogatina do squad ensina em vez de remarcar; o mesmo horário não muda nada', async () => {
    const s = await scheduled();
    const { session: other } = await s.service.scheduleSession(
      s.discordGuild,
      s.squad.id,
      A,
      'hoje 22h',
      'command',
    );
    const reschedule = () =>
      s.service.rescheduleSession(s.discordGuild, s.session.id, A, 'hoje 22h', 'event');

    await expect(reschedule()).rejects.toMatchObject({
      code: 'SESSION_TAKEN',
      message: expect.stringContaining('Aperte VOU nela'),
    });

    await s.service.cancelSession(s.discordGuild, other.id, A, 'event');
    await expect(reschedule()).rejects.toMatchObject({
      code: 'SESSION_TAKEN',
      message: expect.stringContaining('hoje às 22:05'),
    });

    const sent = s.channel.sent.length;
    const same = await s.service.rescheduleSession(
      s.discordGuild,
      s.session.id,
      A,
      'hoje 21h',
      'event',
    );
    expect(same.outcome).toBe('unchanged');
    expect(s.channel.sent).toHaveLength(sent);
  });

  it('a chamada pública no ar passa a anunciar o horário novo', async () => {
    const s = await scheduled();
    await s.service.callForPlayers(s.discordGuild, s.session.id, A, 'event');
    const call = s.search.sent.at(-1)!;

    await s.service.rescheduleSession(s.discordGuild, s.session.id, A, 'hoje 22h', 'event');

    expect(embedOf(call)?.description).toContain(`<t:${unix(TONIGHT.getTime() + HOUR_MS)}:F>`);
    expect(call.deleted).toBe(false);
  });

  it('a lista velha do job não lembra nem começa a jogatina remarcada para mais tarde', async () => {
    const s = await scheduled();
    s.clock.now = TONIGHT.getTime();
    // O job listou a jogatina das 21h para lembrar e começar...
    const due = await s.service.dueSessions(GUILD_ID);
    expect(due.start.map((session) => session.id)).toEqual([s.session.id]);

    // ...e ela foi para as 23h antes de o job chegar nela.
    await s.service.rescheduleSession(s.discordGuild, s.session.id, A, 'hoje 23h', 'event');

    expect(await s.service.remindSession(s.discordGuild, due.remind[0]!)).toBeNull();
    expect(await s.service.startSession(s.discordGuild, due.start[0]!)).toBeNull();
    expect(sessionRow()).toMatchObject({
      remindedAt: null,
      startedAt: null,
      voiceReservedAt: null,
    });
  });

  it('o modal abre com o horário atual no fuso do servidor', async () => {
    const s = await scheduled();

    const modal = await s.service.rescheduleForm(s.discordGuild, s.session.id, A);

    expect(JSON.stringify(modal.toJSON())).toContain('Marcada para hoje às 21:00.');
  });
});

describe('SquadService: lembrete, início e presença', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('jogatina sem mensagem (agendamento antigo) ganha a mensagem completa no lembrete', async () => {
    const s = scenario();

    const first = await s.service.remindSession(s.discordGuild, s.session);
    const second = await s.service.remindSession(s.discordGuild, sessionRow());

    expect(first?.voiceChannelId).toBe(s.voice.id);
    expect(second).toBeNull();
    const message = messageById(s, sessionRow().messageId)!;
    expect(message.payload.content).toBe(`<@${A}> <@${B}>`);
    expect(buttonLabels(message)).toEqual([
      'VOU',
      'NÃO VOU',
      'CHAMAR GENTE',
      'TRAZER CONVIDADO',
      'REMARCAR',
      'CANCELAR',
    ]);
  });

  it('jogatina anunciada ganha a sala na mensagem e um lembrete curto para quem não recusou', async () => {
    const s = scenario();
    store.sessions = [];
    await s.service.scheduleSession(s.discordGuild, s.squad.id, A, 'hoje 21h', 'command');
    await s.service.vote(s.discordGuild, sessionRow().id, B, false);
    s.clock.now = TONIGHT.getTime() - 20 * MINUTE_MS;

    await s.service.remindSession(s.discordGuild, sessionRow());

    const reminder = s.channel.sent.at(-1)!;
    expect(reminder.payload.content).toContain(`<@${A}>`);
    expect(reminder.payload.content).not.toContain(`<@${B}>`);
    expect(reminder.payload.content).toContain(`<#${s.voice.id}>`);
    const room = embedOf(messageById(s, sessionRow().messageId))?.fields?.find(
      (field) => field.name === 'Sala',
    );
    expect(room?.value).toContain(`<#${s.voice.id}>`);
  });

  it('sem sala, a mensagem manda usar qualquer voice livre', async () => {
    const s = scenario({ voicePermissions: ALL_BUT_ADMIN & ~PermissionFlagsBits.Connect });

    await s.service.remindSession(s.discordGuild, s.session);

    const field = embedOf(messageById(s, sessionRow().messageId))?.fields?.find(
      (item) => item.name === 'Sala',
    );
    expect(field?.value).toBe(NO_RESERVED_VOICE_NOTE);
  });

  it('o início move quem está em outro voice e chama quem não está, uma vez só', async () => {
    const s = scenario();
    const lobby = s.guild.add(fakeVoice());
    const stateA = s.guild.putInVoice(A, lobby.id);
    await s.service.reserveVoice(s.discordGuild, s.session);
    s.clock.now = s.session.startsAt.getTime();

    const first = await s.service.startSession(s.discordGuild, sessionRow());
    const second = await s.service.startSession(s.discordGuild, sessionRow());

    expect(first).toEqual({ moved: [A], pinged: [B] });
    expect(second).toBeNull();
    expect(stateA.setChannel).toHaveBeenCalledTimes(1);
    expect(stateA.setChannel).toHaveBeenCalledWith(s.voice.id, expect.any(String));
    const ping = s.channel.sent.find((message) =>
      String(message.payload.content).includes('começou'),
    );
    expect(ping?.payload.content).toContain(`<@${B}>`);
    expect(ping?.payload.content).toContain(`<#${s.voice.id}>`);
  });

  it('jogatina cancelada não começa', async () => {
    const s = scenario();
    sessionRow().cancelledAt = new Date(NOW);

    expect(await s.service.startSession(s.discordGuild, sessionRow())).toBeNull();
    expect(await s.service.reserveVoice(s.discordGuild, sessionRow())).toBeNull();
    expect((await s.service.dueSessions(GUILD_ID)).remind).toEqual([]);
  });

  it('sem sala, dois vou contam como jogatina que rolou no início', async () => {
    const s = scenario({ voicePermissions: ALL_BUT_ADMIN & ~PermissionFlagsBits.Connect });
    sessionRow().goingIds = [A, B];
    s.clock.now = s.session.startsAt.getTime();

    await s.service.startSession(s.discordGuild, sessionRow());

    expect(sessionRow().playedAt).not.toBeNull();
  });

  it('membro no voice reservado confirma o squad e marca que a jogatina rolou', async () => {
    const s = scenario();
    await s.service.reserveVoice(s.discordGuild, s.session);
    squadRow().warnedAt = new Date(NOW - DAY_MS);

    expect(await s.service.confirmVoicePresence(s.discordGuild, s.voice.id, C)).toBe(false);
    expect(await s.service.confirmVoicePresence(s.discordGuild, s.voice.id, A)).toBe(true);

    expect(sessionRow().playedAt).not.toBeNull();
    expect(squadRow().lastConfirmedAt).not.toBeNull();
    expect(squadRow().warnedAt).toBeNull();
  });

  it('"Vou" confirma o squad, zera o aviso e reedita a contagem', async () => {
    const s = scenario();
    await s.service.remindSession(s.discordGuild, s.session);
    squadRow().warnedAt = new Date(NOW - DAY_MS);

    const updated = await s.service.vote(s.discordGuild, s.session.id, A, true);

    expect(updated.goingIds).toEqual([A]);
    expect(squadRow().lastConfirmedAt).not.toBeNull();
    expect(squadRow().warnedAt).toBeNull();
    const going = embedOf(messageById(s, sessionRow().messageId))?.fields?.find(
      (field) => field.name === 'Vão',
    );
    expect(going?.value).toBe(`<@${A}>`);
  });

  it('a contagem diz como quem vai cabe na party, e passando dela o início manda dividir', async () => {
    const s = scenario({ partySize: 2 });
    seedMember(s.squad.id, C);
    await s.service.remindSession(s.discordGuild, s.session);
    const partyField = () =>
      embedOf(messageById(s, sessionRow().messageId))?.fields?.find(
        (field) => field.name === 'Party',
      );

    await s.service.vote(s.discordGuild, s.session.id, A, true);
    expect(partyField()).toBeUndefined();

    await s.service.vote(s.discordGuild, s.session.id, B, true);
    expect(partyField()?.value).toBe('Fechada, 2 de 2.');

    await s.service.vote(s.discordGuild, s.session.id, C, true);
    expect(partyField()?.value).toBe('Dá 2 parties: 3 vão e cada partida leva até 2. Dividam-se.');

    s.clock.now = s.session.startsAt.getTime();
    await s.service.startSession(s.discordGuild, sessionRow());
    const ping = s.channel.sent.find((message) =>
      String(message.payload.content).includes('começou'),
    );
    expect(ping?.payload.content).toContain('Dá 2 parties');
  });

  it('inatividade avisa primeiro e arquiva depois de 7 dias sem resposta', async () => {
    const s = scenario();
    squadRow().createdAt = new Date(NOW - 5 * WEEK_MS);

    const warned = await s.service.checkInactivity(s.discordGuild);
    expect(warned).toEqual({ warned: [s.squad.id], archived: [] });
    expect(embedOf(s.channel.sent.at(-1))?.title).toBe('> O SQUAD AINDA JOGA?');

    s.clock.now = NOW + 3 * DAY_MS;
    expect(await s.service.checkInactivity(s.discordGuild)).toEqual({ warned: [], archived: [] });

    s.clock.now = NOW + 8 * DAY_MS;
    const archived = await s.service.checkInactivity(s.discordGuild);
    expect(archived).toEqual({ warned: [], archived: [s.squad.id] });
    expect(squadRow().status).toBe('archived');
  });
});
