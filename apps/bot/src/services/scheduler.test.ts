import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScheduledAction } from '@goodbot/db';
import type { Client } from 'discord.js';

const {
  claimDueActions,
  completeScheduledAction,
  failScheduledAction,
  isScheduledActionActive,
  withPunishmentLock,
  createCase,
  getReminder,
  completeReminder,
  markStalePunishmentTransitions,
  markStaleReminderDeliveries,
  markReminderSendAttempt,
  markScheduledUndoAttempting,
  markStaleScheduledUndos,
  listStalePendingChannelLocks,
} = vi.hoisted(() => ({
  claimDueActions: vi.fn(),
  completeScheduledAction: vi.fn(),
  failScheduledAction: vi.fn(),
  isScheduledActionActive: vi.fn(),
  withPunishmentLock: vi.fn(),
  createCase: vi.fn(),
  getReminder: vi.fn(),
  completeReminder: vi.fn(),
  markStalePunishmentTransitions: vi.fn(),
  markStaleReminderDeliveries: vi.fn(),
  markReminderSendAttempt: vi.fn(),
  markScheduledUndoAttempting: vi.fn(),
  markStaleScheduledUndos: vi.fn(),
  listStalePendingChannelLocks: vi.fn(),
}));

vi.mock('@goodbot/db', () => ({
  claimDueActions,
  completeScheduledAction,
  failScheduledAction,
  isScheduledActionActive,
  withPunishmentLock,
  createCase,
  getReminder,
  completeReminder,
  markStalePunishmentTransitions,
  markStaleReminderDeliveries,
  markReminderSendAttempt,
  markScheduledUndoAttempting,
  markStaleScheduledUndos,
  listStalePendingChannelLocks,
}));

const { Scheduler } = await import('./scheduler');
const { UnconfirmedChannelLockError } = await import('./locks');

const GUILD_ID = '900000000000000000';
const TARGET_ID = '800000000000000000';

function action(kind: ScheduledAction['kind'], payload: Record<string, unknown>): ScheduledAction {
  return {
    id: 42,
    guildId: GUILD_ID,
    kind,
    runAt: new Date(),
    payload,
    claimToken: '00000000-0000-0000-0000-000000000042',
    attempts: 1,
    doneAt: null,
  } as ScheduledAction;
}

function setup(next: ScheduledAction) {
  const bans = { fetch: vi.fn(), remove: vi.fn() };
  const members = { fetch: vi.fn() };
  const channels = { fetch: vi.fn() };
  const guild = { bans, members, channels };
  const client = {
    guilds: { fetch: vi.fn().mockResolvedValue(guild) },
    channels: { fetch: vi.fn() },
    users: { fetch: vi.fn() },
    user: { id: '100000000000000001', tag: 'Goodbot' },
  } as unknown as Client;
  const locks = { unlock: vi.fn(), isLocked: vi.fn(), list: vi.fn(), lock: vi.fn() };
  const alerts = { emit: vi.fn() };
  const scheduler = new Scheduler({
    db: {} as never,
    client,
    config: { get: vi.fn(), getSettings: vi.fn().mockResolvedValue({ embedColor: 0 }) } as never,
    modlog: { postCase: vi.fn(), postAction: vi.fn() } as never,
    locks: locks as never,
    polls: { close: vi.fn() } as never,
    autorole: { applyFor: vi.fn() } as never,
    alerts,
    batchSize: 1,
  });
  claimDueActions.mockResolvedValue([next]);
  return { scheduler, bans, members, channels, locks, client, alerts };
}

beforeEach(() => {
  vi.clearAllMocks();
  markStalePunishmentTransitions.mockResolvedValue([]);
  markStaleReminderDeliveries.mockResolvedValue([]);
  markReminderSendAttempt.mockResolvedValue('ready');
  markScheduledUndoAttempting.mockResolvedValue(true);
  markStaleScheduledUndos.mockResolvedValue([]);
  listStalePendingChannelLocks.mockResolvedValue([]);
  completeScheduledAction.mockResolvedValue(true);
  failScheduledAction.mockResolvedValue('retry');
  isScheduledActionActive.mockResolvedValue(true);
  withPunishmentLock.mockImplementation(
    (
      _db: unknown,
      _guild: string,
      _kind: string,
      _target: string,
      run: (tx: unknown) => Promise<unknown>,
    ) => run({}),
  );
});

describe('Scheduler', () => {
  it('não desfaz punição renovada enquanto a ação antiga aguardava o lock', async () => {
    const scheduled = action('unban', { targetId: TARGET_ID });
    const h = setup(scheduled);
    isScheduledActionActive.mockResolvedValue(false);

    expect(await h.scheduler.tick()).toBe(1);
    expect(h.bans.remove).not.toHaveBeenCalled();
    expect(createCase).not.toHaveBeenCalled();
    expect(completeScheduledAction).not.toHaveBeenCalled();
  });

  it('falha REST ao consultar ban mantém a ação para repetir', async () => {
    const scheduled = action('unban', { targetId: TARGET_ID });
    const h = setup(scheduled);
    h.bans.fetch.mockRejectedValue(new Error('Discord 500'));

    expect(await h.scheduler.tick()).toBe(1);
    expect(failScheduledAction).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ id: scheduled.id, error: 'Discord 500' }),
    );
    expect(completeScheduledAction).not.toHaveBeenCalled();
    expect(h.bans.remove).not.toHaveBeenCalled();
  });

  it('timeout estendido fora do bot não é removido ao vencer a tarefa anterior', async () => {
    const scheduled = action('untimeout', { targetId: TARGET_ID });
    const h = setup(scheduled);
    const timeout = vi.fn();
    h.members.fetch.mockResolvedValue({
      user: { tag: 'Alvo' },
      communicationDisabledUntil: new Date(scheduled.runAt.getTime() + 60_000),
      timeout,
    });

    expect(await h.scheduler.tick()).toBe(1);
    expect(h.members.fetch).toHaveBeenCalledWith({ user: TARGET_ID, force: true });
    expect(timeout).not.toHaveBeenCalled();
    expect(createCase).not.toHaveBeenCalled();
    expect(completeScheduledAction).toHaveBeenCalledOnce();
  });

  it('unlock expirado passa a identidade da instância à restauração', async () => {
    const scheduled = action('unlock', { channelId: '700000000000000001', lockId: 17 });
    const h = setup(scheduled);
    const channel = { isThread: () => false };
    h.channels.fetch.mockResolvedValue(channel);
    h.locks.unlock.mockResolvedValue('not-locked');

    expect(await h.scheduler.tick()).toBe(1);
    expect(h.locks.unlock).toHaveBeenCalledWith({
      guildId: GUILD_ID,
      channel,
      reason: expect.any(String),
      expectedLockId: 17,
    });
    expect(completeScheduledAction).toHaveBeenCalledOnce();
  });

  it('lembrete usa nonce estável para repetir envio após crash', async () => {
    const scheduled = action('reminder', { reminderId: 19 });
    const h = setup(scheduled);
    const send = vi.fn().mockResolvedValue({ id: 'mensagem' });
    getReminder.mockResolvedValue({
      id: 19,
      text: 'teste',
      userId: TARGET_ID,
      channelId: '700000000000000001',
      doneAt: null,
      createdAt: new Date(),
    });
    vi.mocked(h.client.channels.fetch).mockResolvedValue({
      isTextBased: () => true,
      send,
    } as never);

    expect(await h.scheduler.tick()).toBe(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: 'r:19', enforceNonce: true }),
    );
    expect(markReminderSendAttempt).toHaveBeenCalledWith({}, scheduled.id, scheduled.claimToken);
    expect(completeReminder).toHaveBeenCalledWith({}, 19);
    expect(completeScheduledAction).toHaveBeenCalledOnce();
  });

  it('falha ao buscar destino antes do envio não inicia janela do nonce', async () => {
    const scheduled = action('reminder', { reminderId: 20 });
    const h = setup(scheduled);
    getReminder.mockResolvedValue({
      id: 20,
      text: 'teste',
      userId: TARGET_ID,
      channelId: '700000000000000001',
      doneAt: null,
      createdAt: new Date(),
    });
    vi.mocked(h.client.channels.fetch).mockRejectedValue(new Error('Discord indisponível'));
    expect(await h.scheduler.tick()).toBe(1);
    expect(markReminderSendAttempt).not.toHaveBeenCalled();
    expect(failScheduledAction).toHaveBeenCalledOnce();
  });

  it('não envia lembrete quando a janela do nonce venceu com claim ainda ativo', async () => {
    const scheduled = action('reminder', { reminderId: 21 });
    const h = setup(scheduled);
    const send = vi.fn();
    getReminder.mockResolvedValue({
      id: 21,
      text: 'teste',
      userId: TARGET_ID,
      channelId: '700000000000000001',
      doneAt: null,
      createdAt: new Date(),
    });
    vi.mocked(h.client.channels.fetch).mockResolvedValue({
      isTextBased: () => true,
      send,
    } as never);
    markReminderSendAttempt.mockResolvedValueOnce('uncertain');

    expect(await h.scheduler.tick()).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(completeScheduledAction).not.toHaveBeenCalled();
    expect(h.alerts.emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: `reminder-uncertain:${scheduled.id}` }),
    );
  });

  it('lock sem confirmação termina sem restaurar e alerta com identidade', async () => {
    const scheduled = action('unlock', { channelId: '700000000000000001', lockId: 17 });
    const h = setup(scheduled);
    h.channels.fetch.mockResolvedValue({ isThread: () => false });
    h.locks.unlock.mockRejectedValue(
      new UnconfirmedChannelLockError(GUILD_ID, '700000000000000001', 17),
    );
    failScheduledAction.mockResolvedValueOnce('terminal');
    expect(await h.scheduler.tick()).toBe(1);
    expect(failScheduledAction).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ id: scheduled.id, attempts: 8 }),
    );
    expect(h.alerts.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: `scheduled-action-terminal:${scheduled.id}`,
        level: 'danger',
      }),
    );
  });

  it('reserva de lock abandonada é alertada mesmo sem unlock agendado', async () => {
    const h = setup(action('unlock', {}));
    claimDueActions.mockResolvedValue([]);
    listStalePendingChannelLocks.mockResolvedValueOnce([
      {
        id: 31,
        guildId: GUILD_ID,
        channelId: '700000000000000001',
      },
    ]);
    expect(await h.scheduler.tick()).toBe(0);
    expect(h.alerts.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'lock-pending:31',
        level: 'danger',
      }),
    );
  });
});
