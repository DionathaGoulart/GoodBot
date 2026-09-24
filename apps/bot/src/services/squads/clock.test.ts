import { HOUR_MS, MINUTE_MS } from '@goodbot/shared';
import { ChannelType } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AGENDA,
  ALICE,
  BOB,
  CATEGORY,
  fakeRoomGuild,
  GUILD,
  LOBBY,
  PANEL,
  SEARCH,
  squadsConfig,
} from './__fixtures__/rooms';

import type { LfgSession } from '@goodbot/db';
import type { Roster, SquadsConfig } from '@goodbot/shared';

/** `lfg_sessions` em memória, com o mesmo contrato do repositório. */
const store = vi.hoisted(() => ({
  sessions: new Map<string, LfgSession>(),
  rosters: new Map<string, Roster>(),
}));

vi.mock('@goodbot/db', () => {
  const open = (session: LfgSession | undefined, guildId: string) =>
    session?.guildId === guildId && (session.status === 'scheduled' || session.status === 'live');
  return {
    listDueLfgSessions: vi.fn((_db: unknown, until: Date) =>
      Promise.resolve(
        [...store.sessions.values()].filter(
          (session) => open(session, session.guildId) && session.startsAt <= until,
        ),
      ),
    ),
    getLfgSession: vi.fn((_db: unknown, guildId: string, id: string) => {
      const session = store.sessions.get(id);
      const roster = store.rosters.get(id);
      return Promise.resolve(session?.guildId === guildId && roster ? { session, roster } : null);
    }),
    updateLfgSession: vi.fn(
      (_db: unknown, guildId: string, id: string, patch: Partial<LfgSession>) => {
        const session = store.sessions.get(id);
        if (!session || !open(session, guildId)) return Promise.resolve(null);
        Object.assign(session, patch);
        return Promise.resolve(session);
      },
    ),
  };
});

const { agendaSteps, SquadAgendaClock } = await import('./clock');

const CAROL = '400000000000000003';
const THREAD = '310000000000000001';
const MESSAGE = '600000000000000001';
const SESSION = '00000000-0000-4000-8000-000000000001';
const NOW = Date.parse('2026-09-24T20:00:00Z');

function roster(overrides: Partial<Roster> = {}, going: string[] = [BOB]): Roster {
  return {
    hostId: ALICE,
    slots: 4,
    visibility: 'open',
    entries: [
      { userId: ALICE, status: 'host', joinedAt: 0 },
      ...going.map((userId, i) => ({ userId, status: 'going' as const, joinedAt: i + 1 })),
    ],
    ...overrides,
  };
}

function session(overrides: Partial<LfgSession> = {}): LfgSession {
  return {
    id: SESSION,
    guildId: GUILD,
    hostId: ALICE,
    startsAt: new Date(NOW + 2 * HOUR_MS),
    slots: 4,
    visibility: 'open',
    note: null,
    status: 'scheduled',
    channelId: AGENDA,
    messageId: MESSAGE,
    threadId: THREAD,
    roomId: null,
    remindedAt: null,
    calledAt: null,
    startedAt: null,
    endedAt: null,
    createdAt: new Date(NOW - 24 * HOUR_MS),
    updatedAt: new Date(NOW - 24 * HOUR_MS),
    ...overrides,
  };
}

describe('agendaSteps', () => {
  const at = (minutesToStart: number) => NOW + 2 * HOUR_MS - minutesToStart * MINUTE_MS;

  it('nada antes da hora de chamar; chamada 1 h antes; lembrete 30 min antes', () => {
    expect(agendaSteps(session(), roster(), at(61), 'none')).toEqual([]);
    expect(agendaSteps(session(), roster(), at(60), 'none')).toEqual(['call']);
    expect(agendaSteps(session(), roster(), at(30), 'none')).toEqual(['call', 'remind']);
    const done = session({ calledAt: new Date(0), remindedAt: new Date(0) });
    expect(agendaSteps(done, roster(), at(10), 'none')).toEqual([]);
  });

  it('não chama reforço em fechada nem em lotada', () => {
    expect(agendaSteps(session(), roster({ visibility: 'closed' }), at(40), 'none')).toEqual([]);
    expect(agendaSteps(session(), roster({ slots: 2 }), at(40), 'none')).toEqual([]);
  });

  it('não lembra jogatina marcada já dentro da janela do lembrete', () => {
    const late = session({ createdAt: new Date(at(20)) });
    expect(agendaSteps(late, roster({ slots: 2 }), at(10), 'none')).toEqual([]);
  });

  it('na hora começa, ou fecha quando só o host confirmou', () => {
    expect(agendaSteps(session(), roster(), at(0), 'none')).toEqual(['start']);
    expect(agendaSteps(session(), roster({}, []), at(0), 'none')).toEqual(['lonely']);
  });

  it('marcada que o bot perdeu por inteiro fecha direto', () => {
    expect(agendaSteps(session(), roster(), at(-3 * 60), 'none')).toEqual(['end']);
  });

  it('rolando: fecha na sala vazia depois da reserva, na sala sumida ou no teto', () => {
    const live = session({ status: 'live', startedAt: new Date(at(0)), roomId: '9' });
    expect(agendaSteps(live, roster(), at(-10), 'empty')).toEqual([]);
    expect(agendaSteps(live, roster(), at(-15), 'empty')).toEqual(['end']);
    expect(agendaSteps(live, roster(), at(-60), 'occupied')).toEqual([]);
    expect(agendaSteps(live, roster(), at(-5), 'gone')).toEqual(['end']);
    expect(agendaSteps(live, roster(), at(-3 * 60), 'occupied')).toEqual(['end']);
    const roomless = session({ status: 'live', startedAt: new Date(at(0)) });
    expect(agendaSteps(roomless, roster(), at(-60), 'none')).toEqual([]);
    expect(agendaSteps(roomless, roster(), at(-3 * 60), 'none')).toEqual(['end']);
  });
});

type Sent = { content?: string; allowedMentions?: { users?: string[]; roles?: string[] } };

function setup(config: SquadsConfig = squadsConfig()) {
  const h = fakeRoomGuild();
  const threadSend = vi.fn((_body: Sent) => Promise.resolve({}));
  (h.channels as Map<string, unknown>).set(THREAD, {
    id: THREAD,
    isThread: () => true,
    send: threadSend,
  });
  const panel = h.addChannel({
    id: PANEL,
    type: ChannelType.GuildText,
    name: 'buscar-squad',
    parentId: CATEGORY,
  });
  const panelSend = vi.fn((_body: Sent) => Promise.resolve({}));
  Object.assign(panel, { send: panelSend });
  (h.guild.roles.cache as Map<string, unknown>).set(SEARCH, {
    id: SEARCH,
    toString: () => `<@&${SEARCH}>`,
  });

  /** Quem está em voz ganha `setChannel`, como o `VoiceState` do discord.js. */
  const moves: [string, string][] = [];
  function inVoice(userId: string, channelId: string) {
    h.setVoice(userId, channelId);
    Object.assign(h.voice.get(userId)!, {
      setChannel: vi.fn((room: { id: string }) => {
        moves.push([userId, room.id]);
        h.setVoice(userId, room.id);
        return Promise.resolve();
      }),
    });
  }

  let now = NOW;
  const openSessionRoom = vi.fn(
    (_guild: unknown, _config: unknown, options: { slots: number }) =>
      Promise.resolve(
        h.addChannel({
          id: '700000000000000001',
          type: ChannelType.GuildVoice,
          name: 'Squad Alfa',
          parentId: CATEGORY,
          userLimit: options.slots,
        }),
      ) as never,
  );
  const refresh = vi.fn(() => Promise.resolve());
  const onChange = vi.fn();
  const record = vi.fn();
  const clock = new SquadAgendaClock({
    client: h.client,
    db: {} as never,
    config: { get: () => Promise.resolve(config) } as never,
    registry: { servedGuildIds: () => [GUILD] },
    audit: { record },
    agenda: { refresh },
    rooms: { openSessionRoom },
    onChange,
    now: () => now,
  });
  return {
    ...h,
    clock,
    threadSend,
    panelSend,
    openSessionRoom,
    refresh,
    onChange,
    record,
    moves,
    inVoice,
    at: (ms: number) => {
      now = ms;
    },
  };
}

function put(s: LfgSession, r: Roster) {
  store.sessions.set(s.id, s);
  store.rosters.set(s.id, r);
  return s;
}

beforeEach(() => {
  store.sessions.clear();
  store.rosters.clear();
});

describe('SquadAgendaClock', () => {
  it('chama reforço uma vez só, marcando o cargo de busca com o link', async () => {
    const h = setup();
    const s = put(session(), roster());
    h.at(s.startsAt.getTime() - 50 * MINUTE_MS);
    await h.clock.tick();
    await h.clock.tick();

    expect(h.panelSend).toHaveBeenCalledOnce();
    const body = h.panelSend.mock.calls[0]![0];
    expect(body.content).toContain(`<@&${SEARCH}>`);
    expect(body.content).toContain('2 vagas');
    expect(body.content).toContain(`/channels/${GUILD}/${AGENDA}/${MESSAGE}`);
    expect(body.allowedMentions).toEqual({ roles: [SEARCH] });
    expect(s.calledAt).not.toBeNull();
  });

  it('lembra na thread quem vai, uma vez só', async () => {
    const h = setup();
    const s = put(session({ calledAt: new Date(0) }), roster());
    h.at(s.startsAt.getTime() - 25 * MINUTE_MS);
    await h.clock.tick();
    await h.clock.tick();

    expect(h.threadSend).toHaveBeenCalledOnce();
    const body = h.threadSend.mock.calls[0]![0];
    expect(body.content).toContain(`<@${ALICE}> <@${BOB}>`);
    expect(body.allowedMentions).toEqual({ users: [ALICE, BOB] });
  });

  it('na hora abre a sala, posta o link e puxa quem vai e está em voz', async () => {
    const h = setup();
    const s = put(
      session({ visibility: 'closed' }),
      roster({ visibility: 'closed' }, [BOB, CAROL]),
    );
    h.inVoice(BOB, LOBBY);
    h.inVoice('400000000000000009', LOBBY); // não está na lista
    h.at(s.startsAt.getTime());
    await h.clock.tick();

    expect(s.status).toBe('live');
    expect(s.roomId).toBe('700000000000000001');
    expect(h.openSessionRoom).toHaveBeenCalledWith(h.guild, expect.anything(), {
      slots: 4,
      members: [ALICE, BOB, CAROL],
      until: s.startsAt.getTime() + 15 * MINUTE_MS,
    });
    expect(h.threadSend.mock.calls[0]![0].content).toContain('<#700000000000000001>');
    expect(h.moves).toEqual([[BOB, '700000000000000001']]);
    expect(h.refresh).toHaveBeenCalledWith(GUILD, SESSION);
    expect(h.onChange).toHaveBeenCalledWith(GUILD);

    await h.clock.tick();
    expect(h.openSessionRoom).toHaveBeenCalledOnce();
  });

  it('aberta não restringe a sala', async () => {
    const h = setup();
    const s = put(session(), roster());
    h.at(s.startsAt.getTime());
    await h.clock.tick();
    expect(h.openSessionRoom.mock.calls[0]![2]).toMatchObject({ members: null });
  });

  it('só o host confirmou: fecha sem sala e avisa na thread', async () => {
    const h = setup();
    const s = put(session(), roster({}, []));
    h.at(s.startsAt.getTime());
    await h.clock.tick();

    expect(s.status).toBe('done');
    expect(h.openSessionRoom).not.toHaveBeenCalled();
    expect(h.threadSend.mock.calls[0]![0].content).toContain('Ninguém confirmou');
    expect(h.refresh).toHaveBeenCalledWith(GUILD, SESSION);
  });

  it('fecha quando a sala esvazia depois da reserva', async () => {
    const h = setup();
    const s = put(session(), roster());
    h.at(s.startsAt.getTime());
    await h.clock.tick();
    h.inVoice(BOB, s.roomId!);

    h.at(s.startsAt.getTime() + 40 * MINUTE_MS);
    await h.clock.tick();
    expect(s.status).toBe('live');

    h.setVoice(BOB, null);
    h.at(s.startsAt.getTime() + 41 * MINUTE_MS);
    await h.clock.tick();
    expect(s.status).toBe('done');
    expect(s.endedAt).not.toBeNull();
    expect(h.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'squad.session.end', source: 'job' }),
    );
  });

  it('guild fora do registro ou módulo desligado: o relógio não mexe', async () => {
    const off = setup(squadsConfig({ enabled: false }));
    const s = put(session(), roster());
    off.at(s.startsAt.getTime());
    await off.clock.tick();
    expect(s.status).toBe('scheduled');

    const elsewhere = setup();
    const other = put(session({ id: 'x', guildId: '999' }), roster());
    elsewhere.at(other.startsAt.getTime());
    await elsewhere.clock.tick();
    expect(other.status).toBe('scheduled');
  });
});
