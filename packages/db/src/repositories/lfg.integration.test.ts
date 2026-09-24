import {
  joinRoster,
  leaveRoster,
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
  listDueLfgSessions,
  listMemberLfgSessions,
  listUpcomingLfgSessions,
  mutateLfgRoster,
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
      startsAt,
      slots,
      visibility: 'open',
      note: 'dificuldade 10',
    });
  }

  it('nasce marcada, com o host na lista', async () => {
    const { session, roster } = await create(new Date(Date.now() + 3_600_000));
    expect(session.status).toBe('scheduled');
    expect(roster.entries).toEqual([
      { userId: HOST, status: 'host', joinedAt: session.createdAt.getTime() },
    ]);
    const read = await getLfgSession(db, GUILD_ID, session.id);
    expect(read?.roster.entries).toHaveLength(1);
    expect(await getLfgSession(db, OTHER_GUILD, session.id)).toBeNull();
  });

  it('grava a diferença da regra e puxa a fila', async () => {
    const { session } = await create(new Date(Date.now() + 7_200_000));
    const now = Date.now();
    await mutateLfgRoster(db, GUILD_ID, session.id, (r) => joinRoster(r, ANA, now));
    const queued = await mutateLfgRoster(db, GUILD_ID, session.id, (r) =>
      joinRoster(r, BIA, now + 1),
    );
    expect(queued.change.outcome).toBe('waiting');

    const left = await mutateLfgRoster(db, GUILD_ID, session.id, (r) => leaveRoster(r, ANA));
    expect(left.change.seated).toEqual([BIA]);
    const read = await getLfgSession(db, GUILD_ID, session.id);
    expect(read && seatedEntries(read.roster).map((e) => [e.userId, e.status])).toEqual([
      [HOST, 'host'],
      [BIA, 'going'],
    ]);

    const grown = await mutateLfgRoster(db, GUILD_ID, session.id, (r) => setRosterSlots(r, 4));
    expect(grown.session.slots).toBe(4);
  });

  it('dois VOU na última vaga ao mesmo tempo: um senta, o outro vai para a fila', async () => {
    const { session } = await create(new Date(Date.now() + 10_800_000));
    const now = Date.now();
    const results = await Promise.all([
      mutateLfgRoster(db, GUILD_ID, session.id, (r) => joinRoster(r, ANA, now)),
      mutateLfgRoster(db, GUILD_ID, session.id, (r) => joinRoster(r, BIA, now)),
    ]);
    expect(results.map((result) => result.change.outcome).sort()).toEqual(['going', 'waiting']);
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
    expect(upcoming[0]?.id).toBe(soon.session.id);
    expect(upcoming.every((s) => s.status === 'scheduled' || s.status === 'live')).toBe(true);

    const counts = await countOpenLfgSessions(db, GUILD_ID, HOST);
    expect(counts.guild).toBe(upcoming.length);
    expect(counts.host).toBe(upcoming.length);
    expect((await countOpenLfgSessions(db, GUILD_ID, ANA)).host).toBe(0);

    const due = await listDueLfgSessions(db, new Date(Date.now() + 120_000));
    expect(due.map((s) => s.id)).toContain(soon.session.id);
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
