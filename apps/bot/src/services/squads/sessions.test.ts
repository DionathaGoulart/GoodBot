import { HOUR_MS, LFG_MAX_EVENTS, MINUTE_MS } from '@goodbot/shared';
import {
  GuildScheduledEventEntityType,
  GuildScheduledEventStatus,
  PermissionFlagsBits,
} from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ALICE, CREATE, fakeRoomGuild, GUILD, squadsConfig } from './__fixtures__/rooms';
import {
  dueSessions,
  sessionName,
  SESSIONS_POLL_MS,
  SquadSessionService,
  upcomingSessions,
} from './sessions';

import type { SessionEvent } from './sessions';
import type { GuildMember } from 'discord.js';

const BOT = 'bot';
/** Segunda-feira, 14/09/2026, 9h em São Paulo. */
const NOW = Date.parse('2026-09-14T12:00:00Z');

let nextEvent = 700000000000000001n;

function event(
  overrides: Partial<SessionEvent> = {},
): SessionEvent & { setStatus: ReturnType<typeof vi.fn> } {
  const id = String(nextEvent++);
  return {
    id,
    name: 'Jogatina de Alice',
    creatorId: BOT,
    status: GuildScheduledEventStatus.Scheduled,
    scheduledStartTimestamp: NOW + HOUR_MS,
    scheduledEndTimestamp: NOW + 4 * HOUR_MS,
    url: `https://discord.com/events/${GUILD}/${id}`,
    setStatus: vi.fn(() => Promise.resolve()),
    ...overrides,
  } as SessionEvent & { setStatus: ReturnType<typeof vi.fn> };
}

describe('regras da jogatina', () => {
  it('o nome cabe no teto do Discord', () => {
    expect(sessionName('Alice')).toBe('Jogatina de Alice');
    expect(sessionName('x'.repeat(200))).toHaveLength(100);
  });

  it('lista só as futuras do bot, da mais próxima para a mais distante', () => {
    const later = event({ scheduledStartTimestamp: NOW + 5 * HOUR_MS });
    const sooner = event({ scheduledStartTimestamp: NOW + HOUR_MS });
    const list = upcomingSessions(
      [
        later,
        event({ creatorId: ALICE }),
        event({ status: GuildScheduledEventStatus.Active }),
        event({ status: GuildScheduledEventStatus.Canceled }),
        event({ scheduledStartTimestamp: NOW - MINUTE_MS }),
        sooner,
      ],
      BOT,
      NOW,
    );
    expect(list.map((session) => session.id)).toEqual([sooner.id, later.id]);
    expect(list[0]).toEqual({
      id: sooner.id,
      name: 'Jogatina de Alice',
      startsAt: NOW + HOUR_MS,
      url: sooner.url,
    });
  });

  it('inicia só a do bot que chegou na hora e ainda não acabou', () => {
    const due = event({ scheduledStartTimestamp: NOW - MINUTE_MS });
    const noEnd = event({ scheduledStartTimestamp: NOW - HOUR_MS, scheduledEndTimestamp: null });
    const list = dueSessions(
      [
        due,
        noEnd,
        event(),
        event({ creatorId: ALICE, scheduledStartTimestamp: NOW - MINUTE_MS }),
        event({
          status: GuildScheduledEventStatus.Active,
          scheduledStartTimestamp: NOW - MINUTE_MS,
        }),
        event({ scheduledStartTimestamp: NOW - 5 * HOUR_MS, scheduledEndTimestamp: NOW - HOUR_MS }),
        event({ scheduledStartTimestamp: NOW - 4 * HOUR_MS, scheduledEndTimestamp: null }),
      ],
      BOT,
      NOW,
    );
    expect(list).toEqual([due, noEnd]);
  });
});

function setup(events: ReturnType<typeof event>[] = []) {
  const h = fakeRoomGuild();
  const store = new Map(events.map((item) => [item.id, item]));
  const create = vi.fn((options: { scheduledStartTime: Date }) => {
    const created = event({ scheduledStartTimestamp: options.scheduledStartTime.getTime() });
    store.set(created.id, created);
    return Promise.resolve(created);
  });
  Object.assign(h.guild, {
    scheduledEvents: { fetch: vi.fn(() => Promise.resolve(new Map(store))), create },
  });
  Object.assign(h.client, { user: { id: BOT } });
  const onChange = vi.fn();
  const record = vi.fn();
  const current = { now: NOW };
  const service = new SquadSessionService({
    client: h.client,
    config: {
      get: () => Promise.resolve(squadsConfig()),
      getSettings: () => Promise.resolve({ timezone: 'America/Sao_Paulo' }),
    } as never,
    registry: { servedGuildIds: () => [GUILD] },
    audit: { record },
    onChange,
    now: () => current.now,
  });
  const member = {
    id: ALICE,
    displayName: 'Alice',
    user: { id: ALICE, username: 'alice' },
  } as unknown as GuildMember;
  return { ...h, service, store, create, onChange, record, current, member };
}

describe('SquadSessionService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('marca evento de voz no canal de criar, com fim em 3 horas', async () => {
    const h = setup();
    const scheduled = await h.service.schedule(
      h.guild,
      h.member,
      'hoje 21h',
      squadsConfig(),
      'command',
    );
    const startsAt = new Date('2026-09-15T00:00:00Z');
    expect(scheduled.startsAt).toEqual(startsAt);
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Jogatina de Alice',
        entityType: GuildScheduledEventEntityType.Voice,
        channel: CREATE,
        scheduledStartTime: startsAt,
        scheduledEndTime: new Date(startsAt.getTime() + 3 * HOUR_MS),
      }),
    );
    expect(h.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'squad.session.create', actor: ALICE }),
    );
    await vi.waitFor(() => {
      expect(h.service.upcoming(GUILD).map((session) => session.id)).toEqual([scheduled.eventId]);
    });
    expect(h.onChange).toHaveBeenCalledWith(GUILD);
  });

  it('recusa agora e horário ilegível antes de criar', async () => {
    const h = setup();
    await expect(
      h.service.schedule(h.guild, h.member, 'agora', squadsConfig(), 'command'),
    ).rejects.toMatchObject({ code: 'WHEN_NOW' });
    await expect(
      h.service.schedule(h.guild, h.member, 'quando der', squadsConfig(), 'command'),
    ).rejects.toMatchObject({ code: 'INVALID_WHEN' });
    expect(h.create).not.toHaveBeenCalled();
  });

  it('sem canal de criar ou sem permissão, diz o que falta', async () => {
    const none = setup();
    await expect(
      none.service.schedule(
        none.guild,
        none.member,
        'hoje 21h',
        squadsConfig({ createChannelId: null }),
        'command',
      ),
    ).rejects.toMatchObject({ code: 'SQUADS_NO_CREATE_CHANNEL' });

    const denied = setup();
    denied.denied.add(PermissionFlagsBits.ManageEvents);
    await expect(
      denied.service.schedule(denied.guild, denied.member, 'hoje 21h', squadsConfig(), 'command'),
    ).rejects.toMatchObject({
      code: 'MISSING_PERMISSIONS',
      message: expect.stringContaining('Gerenciar eventos'),
    });
    expect(denied.create).not.toHaveBeenCalled();
  });

  it(`recusa a partir de ${String(LFG_MAX_EVENTS)} jogatinas futuras do bot`, async () => {
    const full = Array.from({ length: LFG_MAX_EVENTS }, () => event());
    const h = setup([...full, event({ creatorId: ALICE })]);
    await expect(
      h.service.schedule(h.guild, h.member, 'hoje 21h', squadsConfig(), 'command'),
    ).rejects.toMatchObject({ code: 'SQUADS_TOO_MANY_EVENTS' });

    const room = setup(full.slice(1));
    await expect(
      room.service.schedule(room.guild, room.member, 'hoje 21h', squadsConfig(), 'command'),
    ).resolves.toMatchObject({ eventId: expect.any(String) });
  });

  it('o poll avisa o painel só quando a lista muda', async () => {
    const h = setup([event()]);
    await h.service.tick();
    expect(h.onChange).toHaveBeenCalledOnce();
    await h.service.tick();
    expect(h.onChange).toHaveBeenCalledOnce();
    h.store.clear();
    await h.service.tick();
    expect(h.onChange).toHaveBeenCalledTimes(2);
    expect(h.service.upcoming(GUILD)).toEqual([]);
  });

  it('inicia a jogatina na hora certa, sem esperar o poll', async () => {
    vi.useFakeTimers();
    const soon = event({ scheduledStartTimestamp: NOW + MINUTE_MS });
    const h = setup([soon]);
    await h.service.tick();
    expect(soon.setStatus).not.toHaveBeenCalled();
    h.current.now = NOW + MINUTE_MS + 1_000;
    await vi.advanceTimersByTimeAsync(MINUTE_MS + 1_000);
    expect(soon.setStatus).toHaveBeenCalledWith(
      GuildScheduledEventStatus.Active,
      expect.any(String),
    );
    expect(h.service.upcoming(GUILD)).toEqual([]);
  });

  it('início além do poll fica para o poll, sem timer', async () => {
    vi.useFakeTimers();
    const h = setup([event({ scheduledStartTimestamp: NOW + SESSIONS_POLL_MS + MINUTE_MS })]);
    await h.service.tick();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('módulo desligado esquece a guild', async () => {
    const h = setup([event()]);
    await h.service.tick();
    expect(h.service.upcoming(GUILD)).toHaveLength(1);
    Object.assign(h.service, {
      config: { get: () => Promise.resolve(squadsConfig({ enabled: false })) },
    });
    await h.service.tick();
    expect(h.service.upcoming(GUILD)).toEqual([]);
  });
});
