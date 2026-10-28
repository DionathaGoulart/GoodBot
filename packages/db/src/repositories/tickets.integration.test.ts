import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Db } from '../client';
import { loadRootEnv } from '../env';
import {
  cleanupExpiredTicketOpenings,
  closeTicket,
  confirmTicketOpening,
  createTicketType,
  listInactiveTickets,
  releaseTicketOpening,
  reserveTicketOpening,
  touchTicketActivity,
} from './tickets';
import { ticketOpenReservations, tickets } from '../schema/community';
import { guilds } from '../schema/guilds';

loadRootEnv();
const url = process.env.DATABASE_URL;
const guildId = `7${String(Date.now()).padStart(17, '0')}`;
const userA = '100000000000000001';
const userB = '100000000000000002';
const botId = '100000000000000099';

describe.skipIf(!url)('tickets (integração com Postgres)', () => {
  let db: Db;
  let end: () => Promise<void>;
  let typeId: string;
  let nextChannel = 0;

  beforeAll(async () => {
    const connection = createDb(url!, { max: 4 });
    db = connection.db;
    end = () => connection.sql.end();
    await db.insert(guilds).values({ id: guildId, name: 'Teste', ownerId: botId });
    const type = await createTicketType(db, {
      guildId,
      name: 'suporte',
      categoryId: '200000000000000001',
    });
    if (!type) throw new Error('tipo de ticket não criado');
    typeId = type.id;
  });

  afterAll(async () => {
    await db.delete(guilds).where(eq(guilds.id, guildId));
    await end();
  });

  const input = (userId: string, limit = 1) => ({ guildId, userId, typeId, limit });

  async function confirm(id: string) {
    nextChannel += 1;
    return confirmTicketOpening(db, id, `3000000000000${String(nextChannel).padStart(5, '0')}`);
  }

  it('um usuário não excede o limite sob duas aberturas simultâneas', async () => {
    const [a, b] = await Promise.all([
      reserveTicketOpening(db, input(userA)),
      reserveTicketOpening(db, input(userA)),
    ]);
    expect([a.reserved, b.reserved].sort()).toEqual([false, true]);
    const winner = a.reserved ? a : b;
    if (!winner.reserved) throw new Error('reserva vencedora ausente');
    const ticket = await confirm(winner.id);
    expect(ticket?.number).toBe(winner.number);
    const third = await reserveTicketOpening(db, input(userA));
    expect(third).toEqual({ reserved: false, open: 1 });
  });

  it('usuários simultâneos recebem números distintos e crescentes', async () => {
    const [a, b] = await Promise.all([
      reserveTicketOpening(db, input(userB, 3)),
      reserveTicketOpening(db, input(botId, 3)),
    ]);
    expect(a.reserved && b.reserved).toBe(true);
    if (!a.reserved || !b.reserved) throw new Error('reserva concorrente ausente');
    expect(new Set([a.number, b.number]).size).toBe(2);
    expect(Math.min(a.number, b.number)).toBeGreaterThan(1);
    expect(await confirm(a.id)).toMatchObject({ number: a.number });
    expect(await confirm(b.id)).toMatchObject({ number: b.number });
  });

  it('reserva expirada libera vaga, não pode ser confirmada e é removível', async () => {
    const first = await reserveTicketOpening(db, input(userB, 2));
    expect(first.reserved).toBe(true);
    if (!first.reserved) throw new Error('reserva ausente');
    await db
      .update(ticketOpenReservations)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(ticketOpenReservations.id, first.id));
    expect(await confirm(first.id)).toBeNull();
    expect(await cleanupExpiredTicketOpenings(db, guildId)).toBe(1);
    const replacement = await reserveTicketOpening(db, input(userB, 2));
    expect(replacement.reserved).toBe(true);
    if (replacement.reserved) await releaseTicketOpening(db, replacement.id);
  });

  it('atividade persistida impede fechamento com leitura antiga', async () => {
    const [ticket] = await db.select().from(tickets).where(eq(tickets.userId, userA)).limit(1);
    if (!ticket) throw new Error('ticket de teste ausente');

    const old = new Date(Date.now() - 2 * 60 * 60_000);
    const cutoff = new Date(Date.now() - 60 * 60_000);
    await db.update(tickets).set({ lastActivityAt: old }).where(eq(tickets.id, ticket.id));
    expect((await listInactiveTickets(db, guildId, cutoff)).map((row) => row.id)).toContain(
      ticket.id,
    );
    expect(await touchTicketActivity(db, ticket.channelId, new Date())).toBe(true);
    expect(
      await closeTicket(db, ticket.id, {
        closedBy: botId,
        reason: 'inativo',
        inactiveBefore: cutoff,
      }),
    ).toBeNull();
    expect((await listInactiveTickets(db, guildId, cutoff)).map((row) => row.id)).not.toContain(
      ticket.id,
    );
  });
});
