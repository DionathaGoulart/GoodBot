import {
  acceptInvite,
  inviteToRoster,
  joinRoster,
  kickFromRoster,
  leaveRoster,
  LFG_PROMOTE_COOLDOWN_MINUTES,
  seatedEntries,
  setRosterSlots,
  UserFacingError,
} from '@goodbot/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Db } from '../client';
import { loadRootEnv } from '../env';
import {
  countOpenLfgSessions,
  createLfgSession,
  getLfgSession,
  getOpenLfgCallByHost,
  listDueLfgSessions,
  listMemberLfgSessions,
  listUpcomingLfgSessions,
  mutateLfgRoster,
  setLfgPromotedAt,
  updateLfgSession,
} from './lfg';
import { guilds } from '../schema/guilds';

loadRootEnv();
const url = process.env.DATABASE_URL;

// Guild fictícia (snowflake válido) para isolar o teste; removida no fim.
const GUILD_ID = `7${String(Date.now()).padStart(17, '0')}`;
const OTHER_GUILD = `6${String(Date.now()).padStart(17, '0')}`;
const HOST = '100000000000000001';
const ANA = '100000000000000002';
const BIA = '100000000000000003';
const CAIO = '100000000000000004';

describe.skipIf(!url)('lfg (integração com Postgres)', () => {
  let db: Db;
  let end: () => Promise<void>;

  beforeAll(async () => {
    const client = createDb(url!, { max: 4 });
    db = client.db;
    end = () => client.sql.end();
    await db.insert(guilds).values([
      { id: GUILD_ID, name: 'Teste LFG', ownerId: HOST },
      { id: OTHER_GUILD, name: 'Outra', ownerId: HOST },
    ]);
  });

  afterAll(async () => {
    await db.delete(guilds).where(eq(guilds.id, GUILD_ID));
    await db.delete(guilds).where(eq(guilds.id, OTHER_GUILD));
    await end();
  });

  function create(startsAt: Date, slots = 2) {
    return createLfgSession(db, {
      guildId: GUILD_ID,
      hostId: HOST,
      kind: 'scheduled',
      startsAt,
      slots,
      visibility: 'open',
      note: 'dificuldade 10',
    });
  }

  function call(hostId: string, guildId = GUILD_ID) {
    return createLfgSession(db, {
      guildId,
      hostId,
      kind: 'now',
      startsAt: new Date(),
      slots: 3,
      visibility: 'open',
      note: 'D10, missão de 40 min',
      roomId: '900000000000000001',
    });
  }

  it('nasce marcada, com o host na lista', async () => {
    const { session, roster } = await create(new Date(Date.now() + 3_600_000));
    expect(session).toMatchObject({ status: 'scheduled', kind: 'scheduled', startedAt: null });
    expect(roster.entries).toEqual([
      { userId: HOST, status: 'host', joinedAt: session.createdAt.getTime(), invitedBy: null },
    ]);
    const read = await getLfgSession(db, GUILD_ID, session.id);
    expect(read?.roster.entries).toHaveLength(1);
    expect(await getLfgSession(db, OTHER_GUILD, session.id)).toBeNull();
  });

  it('grava a diferença da regra; lotada recusa, sem fila', async () => {
    const { session } = await create(new Date(Date.now() + 7_200_000));
    const now = Date.now();
    await mutateLfgRoster(db, GUILD_ID, session.id, (r) => joinRoster(r, ANA, now));
    await expect(
      mutateLfgRoster(db, GUILD_ID, session.id, (r) => joinRoster(r, BIA, now + 1)),
    ).rejects.toMatchObject({ code: 'LFG_FULL' });

    const left = await mutateLfgRoster(db, GUILD_ID, session.id, (r) => leaveRoster(r, ANA));
    expect(left.change.seated).toEqual([]);
    await mutateLfgRoster(db, GUILD_ID, session.id, (r) => joinRoster(r, BIA, now + 2));
    const read = await getLfgSession(db, GUILD_ID, session.id);
    expect(read && seatedEntries(read.roster).map((e) => [e.userId, e.status])).toEqual([
      [HOST, 'host'],
      [BIA, 'going'],
    ]);

    const grown = await mutateLfgRoster(db, GUILD_ID, session.id, (r) => setRosterSlots(r, 4));
    expect(grown.session.slots).toBe(4);
  });

  it('dois VOU na última vaga ao mesmo tempo: um senta, o outro ouve "lotou"', async () => {
    const { session } = await create(new Date(Date.now() + 10_800_000));
    const now = Date.now();
    const results = await Promise.allSettled([
      mutateLfgRoster(db, GUILD_ID, session.id, (r) => joinRoster(r, ANA, now)),
      mutateLfgRoster(db, GUILD_ID, session.id, (r) => joinRoster(r, BIA, now)),
    ]);
    const outcomes = results.map((result) =>
      result.status === 'fulfilled'
        ? result.value.change.outcome
        : (result.reason as UserFacingError).code,
    );
    expect(outcomes.sort()).toEqual(['LFG_FULL', 'going']);
    const read = await getLfgSession(db, GUILD_ID, session.id);
    expect(read?.roster.entries).toHaveLength(2);
  });

  it('convite grava invitedBy, aceitar senta e tirar apaga o pendente', async () => {
    const { session } = await create(new Date(Date.now() + 12_600_000), 3);
    const now = Date.now();
    const invited = await mutateLfgRoster(db, GUILD_ID, session.id, (r) =>
      inviteToRoster(r, [ANA, BIA], HOST, now),
    );
    expect(invited.change.outcome).toEqual({ invited: [ANA, BIA], skipped: [] });
    let read = await getLfgSession(db, GUILD_ID, session.id);
    expect(read?.roster.entries.find((e) => e.userId === ANA)).toMatchObject({
      status: 'invited',
      invitedBy: HOST,
    });

    await mutateLfgRoster(db, GUILD_ID, session.id, (r) => acceptInvite(r, ANA));
    await mutateLfgRoster(db, GUILD_ID, session.id, (r) => kickFromRoster(r, BIA));
    read = await getLfgSession(db, GUILD_ID, session.id);
    expect(
      read && seatedEntries(read.roster).map((e) => [e.userId, e.status, e.invitedBy]),
    ).toEqual([
      [HOST, 'host', null],
      [ANA, 'going', HOST],
    ]);
  });

  it('dois ACEITAR na última vaga ao mesmo tempo: um senta, o outro ouve "lotou"', async () => {
    const { session } = await create(new Date(Date.now() + 13_600_000), 2);
    await mutateLfgRoster(db, GUILD_ID, session.id, (r) =>
      inviteToRoster(r, [ANA, BIA], HOST, Date.now()),
    );
    const results = await Promise.allSettled([
      mutateLfgRoster(db, GUILD_ID, session.id, (r) => acceptInvite(r, ANA)),
      mutateLfgRoster(db, GUILD_ID, session.id, (r) => acceptInvite(r, BIA)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const read = await getLfgSession(db, GUILD_ID, session.id);
    expect(read && seatedEntries(read.roster)).toHaveLength(2);
  });

  it('card nasce começado, com a sala, e é um aberto por pessoa', async () => {
    const { session } = await call(ANA);
    expect(session).toMatchObject({
      kind: 'now',
      status: 'live',
      visibility: 'open',
      roomId: '900000000000000001',
    });
    expect(session.startedAt?.getTime()).toBe(session.startsAt.getTime());
    expect((await getOpenLfgCallByHost(db, GUILD_ID, ANA))?.id).toBe(session.id);
    expect(await getOpenLfgCallByHost(db, GUILD_ID, BIA)).toBeNull();
    expect(await getOpenLfgCallByHost(db, OTHER_GUILD, ANA)).toBeNull();

    await expect(call(ANA)).rejects.toMatchObject({ code: 'LFG_CALL_OPEN' });
    // Depois de fechar o primeiro, pode; e o índice é por servidor.
    const other = await call(CAIO, OTHER_GUILD);
    expect(other.session.guildId).toBe(OTHER_GUILD);
    await updateLfgSession(db, GUILD_ID, session.id, { status: 'done' });
    expect(await getOpenLfgCallByHost(db, GUILD_ID, ANA)).toBeNull();
    const again = await call(ANA);
    expect(again.session.id).not.toBe(session.id);
    // Jogatina marcada não conta como card.
    expect(await getOpenLfgCallByHost(db, GUILD_ID, HOST)).toBeNull();
  });

  it('dois cards do mesmo host ao mesmo tempo: um nasce, o outro recusa', async () => {
    const results = await Promise.allSettled([call(CAIO), call(CAIO)]);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'LFG_CALL_OPEN',
    });
  });

  it('divulgar respeita o intervalo e só vale antes do início', async () => {
    const { session } = await create(new Date(Date.now() + 15_000_000));
    const cooldown = LFG_PROMOTE_COOLDOWN_MINUTES * 60_000;
    const t0 = new Date();
    expect((await setLfgPromotedAt(db, GUILD_ID, session.id, t0, cooldown))?.promotedAt).toEqual(
      t0,
    );
    const early = new Date(t0.getTime() + cooldown - 1_000);
    expect(await setLfgPromotedAt(db, GUILD_ID, session.id, early, cooldown)).toBeNull();
    expect(await setLfgPromotedAt(db, OTHER_GUILD, session.id, t0, cooldown)).toBeNull();
    const later = new Date(t0.getTime() + cooldown);
    expect(await setLfgPromotedAt(db, GUILD_ID, session.id, later, cooldown)).not.toBeNull();

    await updateLfgSession(db, GUILD_ID, session.id, { status: 'live' });
    const muchLater = new Date(t0.getTime() + 3 * cooldown);
    expect(await setLfgPromotedAt(db, GUILD_ID, session.id, muchLater, cooldown)).toBeNull();
  });

  it('erro da regra desfaz tudo; jogatina fechada recusa mudança', async () => {
    const { session } = await create(new Date(Date.now() + 14_400_000));
    await expect(
      mutateLfgRoster(db, GUILD_ID, session.id, (r) => leaveRoster(r, HOST)),
    ).rejects.toBeInstanceOf(UserFacingError);

    await updateLfgSession(db, GUILD_ID, session.id, { status: 'cancelled' });
    await expect(
      mutateLfgRoster(db, GUILD_ID, session.id, (r) => joinRoster(r, ANA, Date.now())),
    ).rejects.toMatchObject({ code: 'LFG_SESSION_CLOSED' });
    expect(await updateLfgSession(db, GUILD_ID, session.id, { note: 'x' })).toBeNull();
  });

  it('lista, conta e acha as que vencem', async () => {
    const soon = await create(new Date(Date.now() + 60_000));
    const upcoming = await listUpcomingLfgSessions(db, GUILD_ID, 50);
    const scheduled = await listUpcomingLfgSessions(db, GUILD_ID, 50, 'scheduled');
    expect(scheduled[0]?.id).toBe(soon.session.id);
    expect(scheduled.every((s) => s.kind === 'scheduled')).toBe(true);
    const calls = await listUpcomingLfgSessions(db, GUILD_ID, 50, 'now');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((s) => s.kind === 'now')).toBe(true);
    expect(upcoming).toHaveLength(scheduled.length + calls.length);
    expect(upcoming.every((s) => s.status === 'scheduled' || s.status === 'live')).toBe(true);

    // O teto conta cards e jogatinas juntos.
    const counts = await countOpenLfgSessions(db, GUILD_ID, HOST);
    expect(counts.guild).toBe(upcoming.length);
    expect(counts.host).toBe(scheduled.length);
    expect((await countOpenLfgSessions(db, GUILD_ID, ANA)).host).toBe(1);
    expect((await countOpenLfgSessions(db, GUILD_ID, BIA)).host).toBe(0);

    const due = await listDueLfgSessions(db, new Date(Date.now() + 120_000));
    expect(due.map((s) => s.id)).toContain(soon.session.id);
    // O card aberto sempre vence: o relógio é quem o fecha.
    expect(due.map((s) => s.id)).toEqual(expect.arrayContaining(calls.map((s) => s.id)));
    expect(due.every((s) => s.startsAt.getTime() <= Date.now() + 120_000)).toBe(true);
  });

  it('acha as jogatinas de quem está nelas', async () => {
    const { session } = await create(new Date(Date.now() + 18_000_000));
    await mutateLfgRoster(db, GUILD_ID, session.id, (r) => joinRoster(r, ANA, Date.now()));
    const mine = await listMemberLfgSessions(db, GUILD_ID, ANA, 50);
    expect(mine.map((row) => [row.session.id, row.status])).toContainEqual([session.id, 'going']);
    expect(await listMemberLfgSessions(db, OTHER_GUILD, ANA, 50)).toEqual([]);
    const hosted = await listMemberLfgSessions(db, GUILD_ID, HOST, 50);
    expect(hosted.every((row) => row.status === 'host')).toBe(true);
  });

  it('remarcar só pega a que ainda não começou', async () => {
    const { session } = await create(new Date(Date.now() + 21_600_000));
    await updateLfgSession(db, GUILD_ID, session.id, { status: 'live' });
    expect(
      await updateLfgSession(db, GUILD_ID, session.id, { note: 'x' }, ['scheduled']),
    ).toBeNull();
    expect(await updateLfgSession(db, GUILD_ID, session.id, { note: 'x' })).not.toBeNull();
  });
});
