import { EventEmitter } from 'node:events';

import { DEFAULT_TICKETS_CONFIG, HOUR_MS } from '@goodbot/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Ticket } from '@goodbot/db';

const { cleanupExpiredTicketOpenings, listInactiveTickets, touchTicketActivity } = vi.hoisted(
  () => ({
    cleanupExpiredTicketOpenings: vi.fn(),
    listInactiveTickets: vi.fn(),
    touchTicketActivity: vi.fn(),
  }),
);

vi.mock('@goodbot/db', () => ({
  cleanupExpiredTicketOpenings,
  listInactiveTickets,
  touchTicketActivity,
}));

const { TicketInactivityJob } = await import('./ticket-inactivity');

const guildId = '900000000000000001';
const channelId = '900000000000000002';
const now = new Date('2026-10-28T12:00:00.000Z');
const cutoff = new Date(now.getTime() - HOUR_MS);

function makeJob(input: { recent?: boolean; served?: boolean; enabled?: boolean } = {}) {
  const client = new EventEmitter();
  const last = input.recent
    ? new Date(now.getTime() - 30 * 60_000)
    : new Date(now.getTime() - 2 * HOUR_MS);
  const message = { createdAt: last };
  const fetchMessages = vi.fn().mockResolvedValue({ first: () => message });
  const channel = {
    id: channelId,
    isTextBased: () => true,
    isDMBased: () => false,
    messages: { fetch: fetchMessages },
  };
  const fetchChannel = vi.fn().mockResolvedValue(channel);
  const guild = { id: guildId, channels: { fetch: fetchChannel } };
  Object.assign(client, {
    user: { id: '900000000000000003' },
    guilds: { cache: new Map([[guildId, guild]]) },
  });
  const close = vi.fn().mockResolvedValue(undefined);
  const config = {
    get: vi.fn().mockResolvedValue({
      ...DEFAULT_TICKETS_CONFIG,
      enabled: input.enabled ?? true,
      autoCloseInactiveHours: 1,
    }),
  };
  const job = new TicketInactivityJob({
    db: {} as never,
    client: client as never,
    config: config as never,
    tickets: { close } as never,
    servesGuild: () => input.served ?? true,
    now: () => now.getTime(),
    intervalMs: 10_000,
  });
  return { job, client, close, config, fetchChannel, fetchMessages };
}

beforeEach(() => {
  vi.clearAllMocks();
  cleanupExpiredTicketOpenings.mockResolvedValue(0);
  listInactiveTickets.mockResolvedValue([]);
  touchTicketActivity.mockResolvedValue(true);
});

describe('TicketInactivityJob', () => {
  it('confere a última mensagem no Discord antes de fechar um ticket vencido', async () => {
    const ticket = { id: 1, guildId, channelId, lastActivityAt: cutoff } as Ticket;
    listInactiveTickets.mockResolvedValue([ticket]);
    const { job, close, fetchMessages } = makeJob();

    await job.tick();

    expect(fetchMessages).toHaveBeenCalledWith({ limit: 1 });
    expect(close).toHaveBeenCalledWith(expect.anything(), ticket, {
      actorId: '900000000000000003',
      reason: expect.stringContaining('1 hora(s)'),
      inactiveBefore: cutoff,
    });
  });

  it('mensagem recente após indisponibilidade do bot atualiza o banco e impede o fechamento', async () => {
    listInactiveTickets.mockResolvedValue([
      { id: 2, guildId, channelId, lastActivityAt: cutoff } as Ticket,
    ]);
    const { job, close } = makeJob({ recent: true });

    await job.tick();

    expect(touchTicketActivity).toHaveBeenCalledWith({}, channelId, expect.any(Date));
    expect(close).not.toHaveBeenCalled();
  });

  it('não consulta banco de guild não atendida ou módulo desligado', async () => {
    const blocked = makeJob({ served: false });
    await blocked.job.tick();
    expect(blocked.config.get).not.toHaveBeenCalled();
    expect(cleanupExpiredTicketOpenings).not.toHaveBeenCalled();

    const disabled = makeJob({ enabled: false });
    await disabled.job.tick();
    expect(listInactiveTickets).not.toHaveBeenCalled();
  });

  it('registra mensagens de tickets sem consultar outros canais a cada mensagem', async () => {
    const { job, client } = makeJob();
    listInactiveTickets.mockResolvedValue([]);
    touchTicketActivity.mockResolvedValue(false);
    job.start();
    client.emit('messageCreate', {
      guildId,
      channelId,
      author: { bot: false },
      createdAt: now,
    });
    await vi.waitFor(() => expect(touchTicketActivity).toHaveBeenCalledTimes(1));
    client.emit('messageCreate', {
      guildId,
      channelId,
      author: { bot: false },
      createdAt: now,
    });
    expect(touchTicketActivity).toHaveBeenCalledTimes(1);
    job.stop();
  });
});
