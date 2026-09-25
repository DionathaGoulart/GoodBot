import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AGENDA,
  ALICE,
  BOB,
  CATEGORY,
  fakeRoomGuild,
  GUILD,
  squadsConfig,
} from './__fixtures__/rooms';

import type { LfgSession } from '@goodbot/db';
import type { Roster, RosterChange, SquadsConfig } from '@goodbot/shared';

/**
 * Um `lfg_sessions` em memória com o mesmo contrato do repositório: a regra
 * pura roda sobre a lista inteira e só jogatina aberta muda.
 */
const store = vi.hoisted(() => ({
  sessions: new Map<string, LfgSession>(),
  rosters: new Map<string, Roster>(),
  seq: 0,
}));

vi.mock('@goodbot/db', async () => {
  const { UserFacingError } = await import('@goodbot/shared');
  const open = (session: LfgSession | undefined, guildId: string) =>
    session?.guildId === guildId && (session.status === 'scheduled' || session.status === 'live');
  return {
    createLfgSession: vi.fn(
      (
        _db: unknown,
        input: Pick<
          LfgSession,
          'guildId' | 'hostId' | 'kind' | 'startsAt' | 'slots' | 'visibility' | 'note'
        >,
      ) => {
        store.seq += 1;
        const id = `00000000-0000-4000-8000-${String(store.seq).padStart(12, '0')}`;
        const session = {
          ...input,
          id,
          status: 'scheduled',
          channelId: null,
          messageId: null,
          threadId: null,
          roomId: null,
          remindedAt: null,
          promotedAt: null,
          startedAt: null,
          endedAt: null,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        } as LfgSession;
        const roster: Roster = {
          hostId: input.hostId,
          slots: input.slots,
          visibility: input.visibility,
          entries: [{ userId: input.hostId, status: 'host', joinedAt: 0 }],
        };
        store.sessions.set(id, session);
        store.rosters.set(id, roster);
        return Promise.resolve({ session, roster });
      },
    ),
    countOpenLfgSessions: vi.fn((_db: unknown, guildId: string, hostId: string) => {
      const list = [...store.sessions.values()].filter((session) => open(session, guildId));
      return Promise.resolve({
        guild: list.length,
        host: list.filter((session) => session.hostId === hostId).length,
      });
    }),
    getLfgSession: vi.fn((_db: unknown, guildId: string, id: string) => {
      const session = store.sessions.get(id);
      const roster = store.rosters.get(id);
      return Promise.resolve(session?.guildId === guildId && roster ? { session, roster } : null);
    }),
    listUpcomingLfgSessions: vi.fn((_db: unknown, guildId: string) =>
      Promise.resolve([...store.sessions.values()].filter((session) => open(session, guildId))),
    ),
    listMemberLfgSessions: vi.fn((_db: unknown, guildId: string, userId: string) =>
      Promise.resolve(
        [...store.sessions.values()].flatMap((session) => {
          const entry = store.rosters
            .get(session.id)
            ?.entries.find((candidate) => candidate.userId === userId);
          return open(session, guildId) && entry ? [{ session, status: entry.status }] : [];
        }),
      ),
    ),
    updateLfgSession: vi.fn(
      (
        _db: unknown,
        guildId: string,
        id: string,
        patch: Partial<LfgSession>,
        statuses: readonly string[] = ['scheduled', 'live'],
      ) => {
        const session = store.sessions.get(id);
        if (!session || !open(session, guildId) || !statuses.includes(session.status)) {
          return Promise.resolve(null);
        }
        Object.assign(session, patch);
        return Promise.resolve(session);
      },
    ),
    mutateLfgRoster: vi.fn(
      (
        _db: unknown,
        guildId: string,
        id: string,
        mutate: (roster: Roster, session: LfgSession) => RosterChange<unknown>,
      ) => {
        const session = store.sessions.get(id);
        const roster = store.rosters.get(id);
        if (!session || !roster || !open(session, guildId)) {
          return Promise.reject(
            new UserFacingError('Essa jogatina já acabou ou foi cancelada.', {
              code: 'LFG_SESSION_CLOSED',
            }),
          );
        }
        try {
          const change = mutate(roster, session);
          store.rosters.set(id, change.roster);
          Object.assign(session, {
            slots: change.roster.slots,
            visibility: change.roster.visibility,
          });
          return Promise.resolve({ session, change });
        } catch (error) {
          return Promise.reject(error as Error);
        }
      },
    ),
  };
});

const { agendaMessage, joinLabel, SquadAgendaService, threadName } = await import('./agenda');

const CAROL = '400000000000000003';
const THREAD = '310000000000000001';
const MESSAGE = '600000000000000001';
/** Segunda-feira, 14/09/2026, 9h em São Paulo. */
const NOW = Date.parse('2026-09-14T12:00:00Z');

type Sent = { content?: string; allowedMentions?: unknown; components?: unknown[] };

function labels(body: ReturnType<typeof agendaMessage>): string[] {
  return body.components.flatMap((row) =>
    row.components.map((button) => (button.data as { label: string }).label),
  );
}

function setup(config: SquadsConfig = squadsConfig({ roomSize: 2 })) {
  const h = fakeRoomGuild();
  const agendaChannel = h.addChannel({
    id: AGENDA,
    type: ChannelType.GuildText,
    name: 'agenda',
    parentId: CATEGORY,
  });
  const threadSend = vi.fn((_body: Sent) => Promise.resolve({}));
  const thread = {
    id: THREAD,
    isThread: () => true,
    send: threadSend,
    setName: vi.fn(() => Promise.resolve()),
    members: { add: vi.fn(() => Promise.resolve()) },
  };
  (h.channels as Map<string, unknown>).set(THREAD, thread);
  const startThread = vi.fn(() => Promise.resolve(thread));
  const send = vi.fn(() => Promise.resolve({ id: MESSAGE, startThread }));
  const edit = vi.fn(() => Promise.resolve());
  Object.assign(agendaChannel, { send, messages: { edit } });

  /** DMs por pessoa; quem está em `closedDms` recusa. */
  const dms = new Map<string, Sent[]>();
  const closedDms = new Set<string>();
  const members = new Map<string, ReturnType<typeof h.member>>();
  const memberOf = (id: string) => {
    let member = members.get(id);
    if (!member) {
      member = Object.assign(h.member(id), {
        guild: h.guild,
        user: { id, bot: false, username: id },
        send: vi.fn((body: Sent) => {
          if (closedDms.has(id)) return Promise.reject(new Error('Cannot send messages'));
          dms.set(id, [...(dms.get(id) ?? []), body]);
          return Promise.resolve({});
        }),
      });
      members.set(id, member);
    }
    return member;
  };
  Object.assign(h.guild.members, {
    fetch: vi.fn((id: string) => Promise.resolve(memberOf(id))),
  });

  const record = vi.fn();
  const service = new SquadAgendaService({
    client: h.client,
    db: {} as never,
    config: {
      get: () => Promise.resolve(config),
      getSettings: () => Promise.resolve({ embedColor: 0xdc143c, timezone: 'America/Sao_Paulo' }),
    } as never,
    audit: { record },
    now: () => NOW,
    renderMs: 10,
  });

  /**
   * A jogatina nasce fechada. Para os casos de aberta, o teste vira a chave
   * direto no banco em memória, sem passar pelo ABRIR (que tem teste próprio).
   */
  async function marcar(visibility: 'open' | 'closed', slots?: number) {
    const scheduled = await service.schedule(
      memberOf(ALICE),
      { when: 'hoje 21h', slots, note: null },
      config,
      'command',
    );
    if (visibility === 'open') {
      const roster = store.rosters.get(scheduled.sessionId)!;
      store.rosters.set(scheduled.sessionId, { ...roster, visibility: 'open' });
      store.sessions.get(scheduled.sessionId)!.visibility = 'open';
    }
    return scheduled;
  }

  return {
    ...h,
    config,
    service,
    send,
    edit,
    startThread,
    thread,
    threadSend,
    dms,
    closedDms,
    memberOf,
    record,
    marcar,
  };
}

beforeEach(() => {
  store.sessions.clear();
  store.rosters.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('mensagem da jogatina', () => {
  const session = {
    id: '00000000-0000-4000-8000-000000000001',
    hostId: ALICE,
    startsAt: new Date(NOW + 3_600_000),
    note: 'dificuldade 10',
    status: 'scheduled' as const,
  };

  it('o botão de entrar diz o que acontece, e lotada não vira espera', () => {
    const roster: Roster = {
      hostId: ALICE,
      slots: 2,
      visibility: 'open',
      entries: [{ userId: ALICE, status: 'host', joinedAt: 0 }],
    };
    expect(joinLabel(roster)).toBe('VOU');
    const full: Roster = {
      ...roster,
      entries: [...roster.entries, { userId: BOB, status: 'going', joinedAt: 1 }],
    };
    expect(joinLabel(full)).toBe('VOU');
    expect(joinLabel({ ...roster, visibility: 'closed' })).toBe('PEDIR VAGA');
  });

  it('lista quem vai e os pedidos, com a nota, e não tem lista de espera', () => {
    const body = agendaMessage(session, {
      hostId: ALICE,
      slots: 2,
      visibility: 'closed',
      entries: [
        { userId: ALICE, status: 'host', joinedAt: 0 },
        { userId: BOB, status: 'going', joinedAt: 1 },
        { userId: CAROL, status: 'requested', joinedAt: 2 },
      ],
    });
    const embed = body.embeds[0]?.data;
    expect(embed?.title).toBe('> JOGATINA · FECHADA');
    expect(embed?.description).toContain('> dificuldade 10');
    expect(embed?.fields?.map((field) => field.name)).toEqual(['Vão (2/2)', 'Pediram vaga (1)']);
    expect(embed?.fields?.[0]?.value).toBe(`<@${ALICE}>\n<@${BOB}>`);
    expect(labels(body)).toEqual(['PEDIR VAGA', 'SAIR', 'GERENCIAR']);
  });

  it('rolando, some o GERENCIAR: a jogatina é do relógio', () => {
    const roster: Roster = {
      hostId: ALICE,
      slots: 2,
      visibility: 'open',
      entries: [{ userId: ALICE, status: 'host', joinedAt: 0 }],
    };
    expect(labels(agendaMessage({ ...session, status: 'live' }, roster))).toEqual(['VOU', 'SAIR']);
  });

  it('encerrada perde os botões', () => {
    const roster: Roster = {
      hostId: ALICE,
      slots: 2,
      visibility: 'open',
      entries: [{ userId: ALICE, status: 'host', joinedAt: 0 }],
    };
    expect(agendaMessage({ ...session, status: 'done' }, roster).components).toEqual([]);
    expect(agendaMessage({ ...session, status: 'cancelled' }, roster).components).toEqual([]);
  });

  it('a thread leva dia e hora no fuso da guild', () => {
    expect(threadName(new Date('2026-09-15T00:00:00Z'), 'America/Sao_Paulo')).toBe(
      'Jogatina 14/09 21:00',
    );
  });
});

describe('marcar', () => {
  it('posta a mensagem, abre a thread e grava onde ficou', async () => {
    const h = setup();
    const scheduled = await h.marcar('closed');
    expect(scheduled.url).toBe(`https://discord.com/channels/${GUILD}/${AGENDA}/${MESSAGE}`);
    expect(scheduled.startsAt.toISOString()).toBe('2026-09-15T00:00:00.000Z');
    expect(h.startThread).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Jogatina 14/09 21:00' }),
    );
    const session = store.sessions.get(scheduled.sessionId);
    expect(session).toMatchObject({
      kind: 'scheduled',
      visibility: 'closed',
      slots: 2,
      channelId: AGENDA,
      messageId: MESSAGE,
      threadId: THREAD,
    });
    expect(h.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'squad.session.create', actor: ALICE }),
    );
  });

  it('sem canal da agenda, sem permissão ou no teto, recusa antes de gravar', async () => {
    const none = setup(squadsConfig({ agendaChannelId: null }));
    await expect(none.marcar('closed')).rejects.toMatchObject({
      code: 'SQUADS_NO_AGENDA_CHANNEL',
    });

    const denied = setup();
    denied.denied.add(PermissionFlagsBits.CreatePublicThreads);
    await expect(denied.marcar('open')).rejects.toMatchObject({ code: 'MISSING_PERMISSIONS' });

    const busy = setup();
    await busy.marcar('open');
    await busy.marcar('open');
    await busy.marcar('open');
    await expect(busy.marcar('open')).rejects.toMatchObject({ code: 'LFG_TOO_MANY_FOR_HOST' });
    expect(store.sessions.size).toBe(3);
  });

  it('"quando" que não se lê recusa antes de gravar', async () => {
    const h = setup();
    await expect(
      h.service.schedule(
        h.memberOf(ALICE),
        { when: 'semana que vem', slots: undefined, note: null },
        h.config,
        'command',
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(store.sessions.size).toBe(0);
  });

  it('mensagem que não sai cancela a jogatina', async () => {
    const h = setup();
    h.send.mockRejectedValueOnce(new Error('boom'));
    await expect(h.marcar('open')).rejects.toThrow('boom');
    expect([...store.sessions.values()][0]?.status).toBe('cancelled');
  });
});

describe('duas pessoas numa aberta', () => {
  it('VOU senta, lotou recusa, e quem sai libera a vaga sem puxar ninguém', async () => {
    const h = setup();
    const { sessionId } = await h.marcar('open');

    await expect(h.service.join(h.memberOf(BOB), sessionId)).resolves.toBe('going');
    await expect(h.service.join(h.memberOf(CAROL), sessionId)).rejects.toMatchObject({
      code: 'LFG_FULL',
    });
    await expect(h.service.join(h.memberOf(BOB), sessionId)).rejects.toMatchObject({
      code: 'LFG_ALREADY_IN',
    });

    await expect(h.service.leave(h.memberOf(BOB), sessionId)).resolves.toBe('going');
    expect(store.rosters.get(sessionId)?.entries.find((e) => e.userId === CAROL)).toBeUndefined();
    expect(h.dms.get(CAROL)).toBeUndefined();
    await expect(h.service.join(h.memberOf(CAROL), sessionId)).resolves.toBe('going');
    await expect(h.service.leave(h.memberOf(ALICE), sessionId)).rejects.toMatchObject({
      code: 'LFG_HOST_CANNOT_LEAVE',
    });
  });

  it('a mensagem é redesenhada uma vez por rajada', async () => {
    vi.useFakeTimers();
    const h = setup(squadsConfig({ roomSize: 4 }));
    const { sessionId } = await h.marcar('open');
    await h.service.join(h.memberOf(BOB), sessionId);
    await h.service.join(h.memberOf(CAROL), sessionId);
    await vi.advanceTimersByTimeAsync(20);
    expect(h.edit).toHaveBeenCalledTimes(1);
    const [messageId, body] = h.edit.mock.calls[0] as unknown as [
      string,
      ReturnType<typeof agendaMessage>,
    ];
    expect(messageId).toBe(MESSAGE);
    expect(body.embeds[0]?.data.fields?.[0]?.name).toBe('Vão (3/4)');
  });
});

describe('duas pessoas numa fechada', () => {
  it('PEDIR VAGA vai para a DM do host, e ACEITAR senta e avisa quem pediu', async () => {
    const h = setup();
    const { sessionId } = await h.marcar('closed');

    await expect(h.service.join(h.memberOf(BOB), sessionId)).resolves.toBe('requested');
    const request = h.dms.get(ALICE)?.[0];
    expect(JSON.stringify(request)).toContain(`squad:req:ok:${GUILD}:${sessionId}:${BOB}`);

    await expect(h.service.hostOf(GUILD, sessionId)).resolves.toBe(ALICE);
    const result = await h.service.answer(h.guild, sessionId, BOB, true, ALICE);
    expect(result).toEqual({ outcome: 'going', userId: BOB });
    expect(JSON.stringify(h.dms.get(BOB))).toContain('foi aceito');

    await expect(h.service.answer(h.guild, sessionId, BOB, true, ALICE)).rejects.toMatchObject({
      code: 'LFG_REQUEST_GONE',
    });
  });

  it('ACEITAR com a lista cheia recusa e o pedido continua esperando', async () => {
    const h = setup(squadsConfig({ roomSize: 3 }));
    const { sessionId } = await h.marcar('closed');
    await h.service.join(h.memberOf(BOB), sessionId);
    await h.service.join(h.memberOf(CAROL), sessionId);
    await h.service.setSlots(h.guild, sessionId, 2, ALICE);
    await h.service.answer(h.guild, sessionId, BOB, true, ALICE);
    await expect(h.service.answer(h.guild, sessionId, CAROL, true, ALICE)).rejects.toMatchObject({
      code: 'LFG_FULL',
    });
    expect(store.rosters.get(sessionId)?.entries.find((e) => e.userId === CAROL)?.status).toBe(
      'requested',
    );
  });

  it('RECUSAR tira o pedido e avisa; a pessoa pode pedir de novo', async () => {
    const h = setup();
    const { sessionId } = await h.marcar('closed');
    await h.service.join(h.memberOf(BOB), sessionId);
    await expect(h.service.answer(h.guild, sessionId, BOB, false, ALICE)).resolves.toEqual({
      outcome: 'rejected',
      userId: BOB,
    });
    expect(JSON.stringify(h.dms.get(BOB))).toContain('recusou');
    await expect(h.service.join(h.memberOf(BOB), sessionId)).resolves.toBe('requested');
  });

  it('host com DM fechada recebe o pedido num ping na thread', async () => {
    const h = setup();
    h.closedDms.add(ALICE);
    const { sessionId } = await h.marcar('closed');
    await h.service.join(h.memberOf(BOB), sessionId);
    expect(h.threadSend).toHaveBeenCalledTimes(1);
    const body = h.threadSend.mock.calls[0]?.[0];
    expect(body?.content).toContain(`<@${ALICE}>`);
    expect(body?.allowedMentions).toEqual({ users: [ALICE] });
    expect(JSON.stringify(body?.components)).toContain('squad:req:no');
  });

  it('jogatina cancelada não responde mais', async () => {
    const h = setup();
    const { sessionId } = await h.marcar('closed');
    await h.service.join(h.memberOf(BOB), sessionId);
    const session = store.sessions.get(sessionId);
    if (session) session.status = 'cancelled';
    await expect(h.service.hostOf(GUILD, sessionId)).resolves.toBeNull();
    await expect(h.service.answer(h.guild, sessionId, BOB, true, ALICE)).rejects.toMatchObject({
      code: 'LFG_SESSION_CLOSED',
    });
  });
});

describe('gerenciar', () => {
  function statusOf(sessionId: string, userId: string) {
    return store.rosters.get(sessionId)?.entries.find((e) => e.userId === userId)?.status;
  }

  it('VAGAS a mais abre lugar; abaixo de quem tem vaga, recusa', async () => {
    const h = setup();
    const { sessionId } = await h.marcar('open');
    await h.service.join(h.memberOf(BOB), sessionId);
    await expect(h.service.join(h.memberOf(CAROL), sessionId)).rejects.toMatchObject({
      code: 'LFG_FULL',
    });

    await h.service.setSlots(h.guild, sessionId, 3, ALICE);
    await expect(h.service.join(h.memberOf(CAROL), sessionId)).resolves.toBe('going');
    await expect(h.service.setSlots(h.guild, sessionId, 2, ALICE)).rejects.toMatchObject({
      code: 'LFG_SLOTS_BELOW_SEATED',
    });
    expect(h.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'squad.session.slots', actor: ALICE }),
    );
  });

  it('ABRIR aceita os pedidos na ordem e recusa os sem vaga, com DM; FECHAR não mexe', async () => {
    const h = setup();
    const { sessionId } = await h.marcar('closed');
    await h.service.join(h.memberOf(BOB), sessionId);
    await h.service.join(h.memberOf(CAROL), sessionId);

    await expect(h.service.toggleVisibility(h.guild, sessionId, ALICE)).resolves.toEqual({
      visibility: 'open',
      accepted: 1,
      refused: 1,
    });
    expect(statusOf(sessionId, BOB)).toBe('going');
    expect(statusOf(sessionId, CAROL)).toBeUndefined();
    expect(JSON.stringify(h.dms.get(BOB))).toContain('foi aceito');
    expect(JSON.stringify(h.dms.get(CAROL))).toContain('lotou antes');

    await expect(h.service.toggleVisibility(h.guild, sessionId, ALICE)).resolves.toEqual({
      visibility: 'closed',
      accepted: 0,
      refused: 0,
    });
    expect(statusOf(sessionId, BOB)).toBe('going');
  });

  it('TIRAR ALGUÉM avisa quem saiu; o host não sai', async () => {
    const h = setup();
    const { sessionId } = await h.marcar('open');
    await h.service.join(h.memberOf(BOB), sessionId);

    await expect(h.service.kick(h.guild, sessionId, BOB, ALICE)).resolves.toBe('going');
    expect(statusOf(sessionId, BOB)).toBeUndefined();
    expect(JSON.stringify(h.dms.get(BOB))).toContain('tirou você da lista');
    await expect(h.service.kick(h.guild, sessionId, ALICE, ALICE)).rejects.toMatchObject({
      code: 'LFG_HOST_CANNOT_LEAVE',
    });
  });

  it('REMARCAR troca a hora, zera o lembrete, renomeia e avisa na thread', async () => {
    const h = setup();
    const { sessionId } = await h.marcar('open');
    await h.service.join(h.memberOf(BOB), sessionId);
    const session = store.sessions.get(sessionId);
    if (session) Object.assign(session, { remindedAt: new Date(NOW) });

    const moved = await h.service.reschedule(
      h.guild,
      sessionId,
      { when: 'amanhã 22h', note: 'terminids' },
      ALICE,
    );
    expect(moved.startsAt.toISOString()).toBe('2026-09-16T01:00:00.000Z');
    expect(store.sessions.get(sessionId)).toMatchObject({
      note: 'terminids',
      remindedAt: null,
    });
    expect(h.thread.setName).toHaveBeenCalledWith('Jogatina 15/09 22:00');
    const notice = h.threadSend.mock.calls.at(-1)?.[0];
    expect(notice?.content).toContain('remarcada');
    expect(notice?.allowedMentions).toEqual({ users: [BOB] });
  });

  it('CANCELAR fecha a mensagem e avisa todo mundo da lista na thread', async () => {
    const h = setup();
    const { sessionId } = await h.marcar('closed');
    await h.service.join(h.memberOf(BOB), sessionId);

    await h.service.cancel(h.guild, sessionId, ALICE);
    expect(store.sessions.get(sessionId)?.status).toBe('cancelled');
    const notice = h.threadSend.mock.calls.at(-1)?.[0];
    expect(notice?.content).toContain('foi cancelada');
    expect(notice?.allowedMentions).toEqual({ users: [BOB] });
    const [, body] = h.edit.mock.calls.at(-1) as unknown as [
      string,
      ReturnType<typeof agendaMessage>,
    ];
    expect(body.components).toEqual([]);
    await expect(h.service.cancel(h.guild, sessionId, ALICE)).rejects.toMatchObject({
      code: 'LFG_SESSION_CLOSED',
    });
  });

  it('rolando, nada do GERENCIAR vale', async () => {
    const h = setup();
    const { sessionId } = await h.marcar('open');
    await h.service.join(h.memberOf(BOB), sessionId);
    const session = store.sessions.get(sessionId);
    if (session) session.status = 'live';

    await expect(h.service.manageable(GUILD, sessionId)).rejects.toMatchObject({
      code: 'LFG_SESSION_STARTED',
    });
    await expect(h.service.setSlots(h.guild, sessionId, 4, ALICE)).rejects.toMatchObject({
      code: 'LFG_SESSION_STARTED',
    });
    await expect(h.service.kick(h.guild, sessionId, BOB, ALICE)).rejects.toMatchObject({
      code: 'LFG_SESSION_STARTED',
    });
    await expect(h.service.cancel(h.guild, sessionId, ALICE)).rejects.toMatchObject({
      code: 'LFG_SESSION_STARTED',
    });
  });

  it('/squad agenda lista onde a pessoa está', async () => {
    const h = setup();
    const { sessionId } = await h.marcar('closed');
    await h.service.join(h.memberOf(BOB), sessionId);
    await expect(h.service.mine(GUILD, BOB, 10)).resolves.toEqual([
      expect.objectContaining({ sessionId, status: 'requested', url: expect.any(String) }),
    ]);
    await expect(h.service.mine(GUILD, CAROL, 10)).resolves.toEqual([]);
  });
});
