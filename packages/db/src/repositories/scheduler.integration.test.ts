import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Db } from '../client';
import { loadRootEnv } from '../env';
import {
  cancelScheduledActions,
  cancelScheduledActionsWithIds,
  claimDueActions,
  completeScheduledAction,
  compensateScheduledPunishment,
  failScheduledAction,
  isScheduledActionActive,
  isCurrentPunishmentTransition,
  markStalePunishmentTransitions,
  markReminderSendAttempt,
  markScheduledUndoAttempting,
  markStaleScheduledUndos,
  markPunishmentTransitionAttempting,
  markPunishmentTransitionRejected,
  markStaleReminderDeliveries,
  recordPunishmentTransition,
  scheduleAction,
  withPunishmentLock,
} from './cases';
import {
  cancelScheduledChannelUnlocks,
  getChannelLock,
  listStalePendingChannelLocks,
  markChannelLockApplied,
  saveChannelLock,
} from './locks';
import { scheduledActions } from '../schema/cases';
import { guilds } from '../schema/guilds';

loadRootEnv();
const url = process.env.DATABASE_URL;
const GUILD_ID = `9${String(Date.now()).padStart(17, '0')}`;
const OWNER_ID = '100000000000000001';

type ClaimOptions = Parameters<typeof claimDueActions>[1];

function claim(db: Db, options: ClaimOptions = {}) {
  return claimDueActions(db, { ...options, guildId: GUILD_ID });
}

describe.skipIf(!url)('scheduler: reserva e geração (PostgreSQL)', () => {
  let db: Db;
  let end: () => Promise<void>;

  beforeAll(async () => {
    const connection = createDb(url!, { max: 3 });
    db = connection.db;
    end = () => connection.sql.end();
    await db.insert(guilds).values({ id: GUILD_ID, name: 'Scheduler teste', ownerId: OWNER_ID });
  });

  afterAll(async () => {
    await db.delete(guilds).where(eq(guilds.id, GUILD_ID));
    await end();
  });

  it('reserva sem concluir, recupera após o lease e protege a conclusão por token', async () => {
    const now = new Date();
    const action = await scheduleAction(db, {
      guildId: GUILD_ID,
      kind: 'unban',
      runAt: new Date(now.getTime() - 1_000),
      payload: { targetId: '200000000000000001' },
    });

    const [first] = await claim(db, { now, limit: 1, kinds: ['unban'] });
    expect(first?.id).toBe(action.id);
    expect(first?.doneAt).toBeNull();
    expect(first?.attempts).toBe(1);
    expect(first?.claimToken).toBeTruthy();

    expect(
      await claim(db, {
        now: new Date(now.getTime() + 9 * 60_000),
        kinds: ['unban'],
      }),
    ).toEqual([]);
    const [reclaimed] = await claim(db, {
      now: new Date(now.getTime() + 11 * 60_000),
      kinds: ['unban'],
    });
    expect(reclaimed?.id).toBe(action.id);
    expect(reclaimed?.attempts).toBe(2);
    expect(reclaimed?.claimToken).not.toBe(first?.claimToken);
    expect(await completeScheduledAction(db, action.id, first!.claimToken!)).toBe(false);
    expect(await completeScheduledAction(db, action.id, reclaimed!.claimToken!)).toBe(true);
    expect(await claim(db, { now: new Date(now.getTime() + 20 * 60_000) })).toEqual([]);
  });

  it('reversão iniciada e não confirmada não volta à fila após crash', async () => {
    const now = new Date();
    const targetId = '200000000000000010';
    const undo = await scheduleAction(db, {
      guildId: GUILD_ID,
      kind: 'unban',
      runAt: new Date(now.getTime() - 1_000),
      payload: { targetId },
    });
    const [claimed] = await claim(db, { now, kinds: ['unban'] });
    expect(claimed?.id).toBe(undo.id);
    expect(await markScheduledUndoAttempting(db, undo.id, claimed!.claimToken!)).toBe(true);
    expect(
      await claim(db, { now: new Date(now.getTime() + 11 * 60_000), kinds: ['unban'] }),
    ).toEqual([]);
    const stale = await markStaleScheduledUndos(db, new Date(now.getTime() + 11 * 60_000));
    expect(stale.map((row) => row.id)).toContain(undo.id);
    const row = await db.query.scheduledActions.findFirst({
      where: (a, { eq }) => eq(a.id, undo.id),
    });
    expect(row?.failedAt).not.toBeNull();
  });

  it('compensação de undo iniciado preserva bloqueio para revisão manual', async () => {
    const now = new Date();
    const targetId = '200000000000000011';
    const undo = await scheduleAction(db, {
      guildId: GUILD_ID,
      kind: 'unban',
      runAt: new Date(now.getTime() - 1_000),
      payload: { targetId },
    });
    const [claimed] = await claim(db, { now, kinds: ['unban'] });
    expect(
      await withPunishmentLock(db, GUILD_ID, 'unban', targetId, (tx) =>
        markScheduledUndoAttempting(tx, undo.id, claimed!.claimToken!),
      ),
    ).toBe(true);
    await withPunishmentLock(db, GUILD_ID, 'unban', targetId, async (tx) => {
      const oldIds = await cancelScheduledActionsWithIds(tx, {
        guildId: GUILD_ID,
        kind: 'unban',
        targetId,
      });
      expect(oldIds).toEqual([undo.id]);
      await compensateScheduledPunishment(tx, oldIds);
    });
    const row = await db.query.scheduledActions.findFirst({
      where: (a, { eq }) => eq(a.id, undo.id),
    });
    expect(row?.payload.undoAttemptAt).toBeDefined();
    const retried = await claim(db, {
      now: new Date(now.getTime() + 11 * 60_000),
      kinds: ['unban'],
    });
    expect(retried).toEqual([]);
    expect(
      (await markStaleScheduledUndos(db, new Date(now.getTime() + 11 * 60_000))).map(
        (item) => item.id,
      ),
    ).toContain(undo.id);
  });

  it('renovação cancela até a reserva já reclamada e mantém apenas a tarefa nova', async () => {
    const targetId = '200000000000000002';
    const old = await scheduleAction(db, {
      guildId: GUILD_ID,
      kind: 'untimeout',
      runAt: new Date(Date.now() - 1_000),
      payload: { targetId },
    });
    const [claimed] = await claim(db, { kinds: ['untimeout'], limit: 1 });
    expect(claimed?.id).toBe(old.id);

    await withPunishmentLock(db, GUILD_ID, 'untimeout', targetId, async (tx) => {
      expect(
        await cancelScheduledActions(tx, { guildId: GUILD_ID, kind: 'untimeout', targetId }),
      ).toBe(1);
      await scheduleAction(tx, {
        guildId: GUILD_ID,
        kind: 'untimeout',
        runAt: new Date(Date.now() + 60_000),
        payload: { targetId },
      });
    });

    expect(await isScheduledActionActive(db, old.id, claimed!.claimToken!)).toBe(false);
    expect(await completeScheduledAction(db, old.id, claimed!.claimToken!)).toBe(false);
    const [current] = await claim(db, {
      kinds: ['untimeout'],
      now: new Date(Date.now() + 61_000),
    });
    expect(current?.id).not.toBe(old.id);
    expect(current?.payload).toMatchObject({ targetId });
    await completeScheduledAction(db, current!.id, current!.claimToken!);
  });

  it('confirma reserva antes do efeito e compensa rejeição definitiva', async () => {
    const targetId = '200000000000000004';
    const old = await scheduleAction(db, {
      guildId: GUILD_ID,
      kind: 'unban',
      runAt: new Date(Date.now() + 24 * 60 * 60_000),
      payload: { targetId },
    });
    let newId = 0;
    await withPunishmentLock(db, GUILD_ID, 'unban', targetId, async () => {
      const staged = await db.transaction(async (tx) => {
        const oldIds = await cancelScheduledActionsWithIds(tx, {
          guildId: GUILD_ID,
          kind: 'unban',
          targetId,
        });
        const next = await scheduleAction(tx, {
          guildId: GUILD_ID,
          kind: 'unban',
          runAt: new Date(Date.now() + 120_000),
          payload: { targetId },
        });
        return { oldIds, next };
      });
      newId = staged.next.id;
      expect(staged.oldIds).toEqual([old.id]);
      const cancelled = await db.query.scheduledActions.findFirst({
        where: (a, { eq }) => eq(a.id, old.id),
      });
      expect(cancelled?.doneAt).not.toBeNull();
      await db.transaction((tx) =>
        compensateScheduledPunishment(tx, staged.oldIds, staged.next.id),
      );
    });
    const previous = await db.query.scheduledActions.findFirst({
      where: (a, { eq }) => eq(a.id, old.id),
    });
    const replacement = await db.query.scheduledActions.findFirst({
      where: (a, { eq }) => eq(a.id, newId),
    });
    expect(previous?.doneAt).toBeNull();
    expect(replacement?.doneAt).not.toBeNull();
  });

  it('não restaura prazo preparado por requisição superada que nunca aplicou REST', async () => {
    const targetId = '200000000000000005';
    const marker1 = await recordPunishmentTransition(db, {
      guildId: GUILD_ID,
      kind: 'unban',
      targetId,
    });
    const pending1 = await scheduleAction(db, {
      guildId: GUILD_ID,
      kind: 'unban',
      runAt: new Date(Date.now() + 24 * 60 * 60_000),
      payload: { targetId, transitionMarkerId: marker1 },
    });
    await withPunishmentLock(db, GUILD_ID, 'unban', targetId, async (tx) => {
      const oldIds = await cancelScheduledActionsWithIds(tx, {
        guildId: GUILD_ID,
        kind: 'unban',
        targetId,
      });
      expect(oldIds).toEqual([pending1.id]);
      const marker2 = await recordPunishmentTransition(tx, {
        guildId: GUILD_ID,
        kind: 'unban',
        targetId,
      });
      expect(
        await isCurrentPunishmentTransition(tx, {
          guildId: GUILD_ID,
          kind: 'unban',
          targetId,
          markerId: marker1,
        }),
      ).toBe(false);
      expect(
        await isCurrentPunishmentTransition(tx, {
          guildId: GUILD_ID,
          kind: 'unban',
          targetId,
          markerId: marker2,
        }),
      ).toBe(true);
      await compensateScheduledPunishment(tx, oldIds);
    });
    const old = await db.query.scheduledActions.findFirst({
      where: (a, { eq }) => eq(a.id, pending1.id),
    });
    expect(old?.doneAt).not.toBeNull();
  });

  it('falha da segunda geração restaura prazo ancestral aplicado, sem reativar reserva anterior', async () => {
    const targetId = '200000000000000007';
    const due = new Date(Date.now() + 24 * 60 * 60_000);
    const g0 = await scheduleAction(db, {
      guildId: GUILD_ID,
      kind: 'unban',
      runAt: due,
      payload: { targetId },
    });
    const g1 = await withPunishmentLock(db, GUILD_ID, 'unban', targetId, async (tx) => {
      const fallbackActionIds = await cancelScheduledActionsWithIds(tx, {
        guildId: GUILD_ID,
        kind: 'unban',
        targetId,
      });
      const transitionMarkerId = await recordPunishmentTransition(tx, {
        guildId: GUILD_ID,
        kind: 'unban',
        targetId,
      });
      return scheduleAction(tx, {
        guildId: GUILD_ID,
        kind: 'unban',
        runAt: due,
        payload: { targetId, transitionMarkerId, fallbackActionIds },
      });
    });
    let g2Id = 0;
    await withPunishmentLock(db, GUILD_ID, 'unban', targetId, async (tx) => {
      const fallbackActionIds = await cancelScheduledActionsWithIds(tx, {
        guildId: GUILD_ID,
        kind: 'unban',
        targetId,
      });
      expect(fallbackActionIds).toEqual([g1.id, g0.id]);
      const marker = await recordPunishmentTransition(tx, {
        guildId: GUILD_ID,
        kind: 'unban',
        targetId,
      });
      const g2 = await scheduleAction(tx, {
        guildId: GUILD_ID,
        kind: 'unban',
        runAt: due,
        payload: { targetId, transitionMarkerId: marker, fallbackActionIds },
      });
      g2Id = g2.id;
      await compensateScheduledPunishment(tx, fallbackActionIds, g2.id);
      await markPunishmentTransitionRejected(tx, marker);
    });
    const [old, first, second] = await Promise.all(
      [g0.id, g1.id, g2Id].map((id) =>
        db.query.scheduledActions.findFirst({ where: (a, { eq }) => eq(a.id, id) }),
      ),
    );
    expect(old?.doneAt).toBeNull();
    expect(first?.doneAt).not.toBeNull();
    expect(second?.doneAt).not.toBeNull();
  });

  it('propaga prazo aplicado através de transição sem nova tarefa', async () => {
    const targetId = '200000000000000008';
    const due = new Date(Date.now() + 24 * 60 * 60_000);
    const g0 = await scheduleAction(db, {
      guildId: GUILD_ID,
      kind: 'unban',
      runAt: due,
      payload: { targetId },
    });
    await withPunishmentLock(db, GUILD_ID, 'unban', targetId, async (tx) => {
      const fallback = await cancelScheduledActionsWithIds(tx, {
        guildId: GUILD_ID,
        kind: 'unban',
        targetId,
      });
      expect(fallback).toEqual([g0.id]);
      await recordPunishmentTransition(tx, {
        guildId: GUILD_ID,
        kind: 'unban',
        targetId,
        fallbackActionIds: fallback,
      });
    });
    await withPunishmentLock(db, GUILD_ID, 'unban', targetId, async (tx) => {
      const fallback = await cancelScheduledActionsWithIds(tx, {
        guildId: GUILD_ID,
        kind: 'unban',
        targetId,
      });
      expect(fallback).toEqual([g0.id]);
      const marker = await recordPunishmentTransition(tx, {
        guildId: GUILD_ID,
        kind: 'unban',
        targetId,
        fallbackActionIds: fallback,
      });
      await compensateScheduledPunishment(tx, fallback);
      await markPunishmentTransitionRejected(tx, marker);
    });
    const restored = await db.query.scheduledActions.findFirst({
      where: (a, { eq }) => eq(a.id, g0.id),
    });
    expect(restored?.doneAt).toBeNull();
  });

  it('falha usa espera progressiva e fica visível após oito tentativas', async () => {
    const targetId = '200000000000000003';
    const start = new Date();
    const action = await scheduleAction(db, {
      guildId: GUILD_ID,
      kind: 'unban',
      runAt: new Date(start.getTime() - 1_000),
      payload: { targetId },
    });
    let now = start;
    for (let expected = 1; expected <= 8; expected++) {
      const [claimed] = await claim(db, { now, kinds: ['unban'] });
      expect(claimed?.id).toBe(action.id);
      expect(claimed?.attempts).toBe(expected);
      const outcome = await failScheduledAction(db, {
        id: action.id,
        claimToken: claimed!.claimToken!,
        attempts: claimed!.attempts,
        error: 'Falha REST',
        now,
      });
      expect(outcome).toBe(expected === 8 ? 'terminal' : 'retry');
      now = new Date(now.getTime() + 2 * 60 * 60_000);
    }
    const [row] = await db.query.scheduledActions.findMany({
      where: (a, { eq }) => eq(a.id, action.id),
    });
    expect(row?.failedAt).not.toBeNull();
    expect(row?.lastError).toBe('Falha REST');
    expect(await claim(db, { now, kinds: ['unban'] })).toEqual([]);
  });

  it('encerra apenas o unlock associado ao lock encerrado', async () => {
    const channelId = '300000000000000001';
    const saved = await saveChannelLock(db, {
      guildId: GUILD_ID,
      channelId,
      roleIds: [GUILD_ID],
      overwrites: [],
      lockedBy: OWNER_ID,
      reason: 'teste',
    });
    expect(saved).not.toBeNull();
    expect(saved?.appliedAt).toBeNull();
    expect(
      (await listStalePendingChannelLocks(db, new Date(Date.now() + 60_000))).map((row) => row.id),
    ).toContain(saved!.id);
    await markChannelLockApplied(db, saved!.id);
    expect((await getChannelLock(db, GUILD_ID, channelId))?.appliedAt).toBeInstanceOf(Date);
    expect(
      (await listStalePendingChannelLocks(db, new Date(Date.now() + 60_000))).map((row) => row.id),
    ).not.toContain(saved!.id);
    const action = await scheduleAction(db, {
      guildId: GUILD_ID,
      kind: 'unlock',
      runAt: new Date(Date.now() + 1_000),
      payload: { channelId, lockId: saved!.id },
    });
    expect(await cancelScheduledChannelUnlocks(db, GUILD_ID, channelId, saved!.id + 1)).toBe(0);
    expect(await cancelScheduledChannelUnlocks(db, GUILD_ID, channelId, saved!.id)).toBe(1);
    const [row] = await db.query.scheduledActions.findMany({
      where: (a, { eq }) => eq(a.id, action.id),
    });
    expect(row?.doneAt).not.toBeNull();
    expect(await getChannelLock(db, GUILD_ID, channelId)).toMatchObject({ id: saved!.id });
  });

  it('lembrete recebe lease curto para retry dentro da janela do nonce', async () => {
    const now = new Date();
    const reminder = await scheduleAction(db, {
      guildId: GUILD_ID,
      kind: 'reminder',
      runAt: new Date(now.getTime() - 1_000),
      payload: { reminderId: 987654321 },
    });
    const [claimed] = await claim(db, { now, kinds: ['reminder'] });
    expect(claimed?.id).toBe(reminder.id);
    expect(claimed?.leaseUntil?.getTime()).toBe(now.getTime() + 90_000);
    await completeScheduledAction(db, reminder.id, claimed!.claimToken!);
  });

  it('lembrete incerto após janela de nonce fica terminal sem reenvio', async () => {
    const now = new Date();
    const reminder = await scheduleAction(db, {
      guildId: GUILD_ID,
      kind: 'reminder',
      runAt: new Date(now.getTime() - 1_000),
      payload: { reminderId: 987654322 },
    });
    const [claimed] = await claim(db, { now, kinds: ['reminder'] });
    expect(claimed?.id).toBe(reminder.id);
    expect(claimed?.payload.firstSendAttemptAt).toBeUndefined();
    expect(await markStaleReminderDeliveries(db, new Date(now.getTime() + 3 * 60_000))).toEqual([]);
    const [retried] = await claim(db, {
      now: new Date(now.getTime() + 3 * 60_000),
      kinds: ['reminder'],
    });
    expect(retried?.id).toBe(reminder.id);
    expect(
      await markReminderSendAttempt(
        db,
        reminder.id,
        retried!.claimToken!,
        new Date(now.getTime() + 3 * 60_000),
      ),
    ).toBe('ready');
    const stale = await markStaleReminderDeliveries(db, new Date(now.getTime() + 6 * 60_000));
    expect(stale.map((row) => row.id)).toContain(reminder.id);
    expect(
      await claim(db, { now: new Date(now.getTime() + 7 * 60_000), kinds: ['reminder'] }),
    ).toEqual([]);
  });

  it('claim ativo não pode reenviar depois da janela do nonce', async () => {
    const now = new Date();
    const reminder = await scheduleAction(db, {
      guildId: GUILD_ID,
      kind: 'reminder',
      runAt: new Date(now.getTime() - 1_000),
      payload: { reminderId: 987654323 },
    });
    const [first] = await claim(db, { now, kinds: ['reminder'] });
    expect(await markReminderSendAttempt(db, reminder.id, first!.claimToken!, now)).toBe('ready');
    const retryAt = new Date(now.getTime() + 100_000);
    const [retry] = await claim(db, { now: retryAt, kinds: ['reminder'] });
    expect(retry?.id).toBe(reminder.id);
    expect(
      await markReminderSendAttempt(
        db,
        reminder.id,
        retry!.claimToken!,
        new Date(now.getTime() + 3 * 60_000),
      ),
    ).toBe('uncertain');
    const terminal = await db.query.scheduledActions.findFirst({
      where: (a, { eq }) => eq(a.id, reminder.id),
    });
    expect(terminal?.failedAt).not.toBeNull();
    expect(
      await failScheduledAction(db, {
        id: reminder.id,
        claimToken: retry!.claimToken!,
        attempts: 2,
        error: 'old nonce',
      }),
    ).toBe('superseded');
  });

  it('preparação abandonada fica terminal e identifica tarefa bloqueada', async () => {
    const targetId = '200000000000000006';
    const markerId = await recordPunishmentTransition(db, {
      guildId: GUILD_ID,
      kind: 'unban',
      targetId,
    });
    const pending = await scheduleAction(db, {
      guildId: GUILD_ID,
      kind: 'unban',
      runAt: new Date(Date.now() - 1_000),
      payload: { targetId, transitionMarkerId: markerId },
    });
    await db
      .update(scheduledActions)
      .set({ createdAt: new Date(Date.now() - 11 * 60_000) })
      .where(eq(scheduledActions.id, markerId));
    const stale = await markStalePunishmentTransitions(db);
    expect(stale.map((row) => row.id)).toContain(markerId);
    const blocked = await db.query.scheduledActions.findFirst({
      where: (a, { eq }) => eq(a.id, pending.id),
    });
    expect(blocked?.failedAt).not.toBeNull();
    expect(await claim(db, { kinds: ['unban'] })).toEqual([]);
  });

  it('watchdog impede REST tardio de transição já terminalizada', async () => {
    const targetId = '200000000000000009';
    const markerId = await recordPunishmentTransition(db, {
      guildId: GUILD_ID,
      kind: 'unban',
      targetId,
    });
    expect(await markPunishmentTransitionAttempting(db, markerId)).toBe(true);
    await db
      .update(scheduledActions)
      .set({ createdAt: new Date(Date.now() - 11 * 60_000) })
      .where(eq(scheduledActions.id, markerId));
    expect((await markStalePunishmentTransitions(db)).map((row) => row.id)).toContain(markerId);
    expect(
      await isCurrentPunishmentTransition(db, {
        guildId: GUILD_ID,
        kind: 'unban',
        targetId,
        markerId,
        expectedState: 'attempting',
      }),
    ).toBe(false);
  });
});
