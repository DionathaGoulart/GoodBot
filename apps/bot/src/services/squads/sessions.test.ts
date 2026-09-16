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
import { A, B, C, createHarness, NOW } from './__fixtures__/harness';
import { NO_RESERVED_VOICE_NOTE } from './embeds';
import { SQUAD_VOICE_MEMBER_BITS, squadTextOverwrites } from './overwrites';

import type { FakeMessage } from './__fixtures__/discord';
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
});

describe('SquadService: marcar jogatina', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hoje 21h: grava quem marcou como vou, anuncia chamando o squad e atualiza o guia', async () => {
    const s = scenario();
    store.sessions = [];

    const result = await s.service.scheduleSession(s.discordGuild, s.squad.id, A, 'hoje 21h', 'command');

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
    expect(buttonLabels(announce)).toEqual(['VOU', 'NÃO VOU', 'CHAMAR GENTE', 'CANCELAR']);
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
    expect(buttonLabels(announce)).toEqual(['REPETIR']);
    // Anúncio já chamou todo mundo: não sai lembrete à parte.
    expect(s.channel.sent.some((message) => String(message.payload.content).includes('começa'))).toBe(
      false,
    );
  });

  it('o mesmo minuto duas vezes vira uma jogatina, e quem pediu de novo passa a ir', async () => {
    const s = scenario();
    store.sessions = [];
    await s.service.scheduleSession(s.discordGuild, s.squad.id, A, 'hoje 21h', 'command');

    const again = await s.service.scheduleSession(s.discordGuild, s.squad.id, B, 'hoje 21:00', 'event');

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
    const { session } = await s.service.scheduleSession(s.discordGuild, s.squad.id, by, when, 'command');
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

    const again = await s.service.scheduleSession(s.discordGuild, s.squad.id, B, 'hoje 9h20', 'event');
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
    expect(buttonLabels(message)).toEqual(['VOU', 'NÃO VOU', 'CHAMAR GENTE', 'CANCELAR']);
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
    expect(partyField()?.value).toBe(
      'Dá 2 parties: 3 vão e cada partida leva até 2. Dividam-se.',
    );

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
