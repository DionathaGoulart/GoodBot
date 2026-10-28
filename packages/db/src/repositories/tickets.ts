import { and, asc, desc, eq, gt, lt, lte, sql } from 'drizzle-orm';

import {
  ticketCounters,
  ticketOpenReservations,
  ticketPanels,
  ticketTypes,
  tickets,
} from '../schema/community';
import { guilds } from '../schema/guilds';

import type { Db, DbExecutor } from '../client';
import type { Ticket, TicketPanel, TicketType } from '../types';
import type { MessageTemplate } from '@goodbot/shared';

async function ensureGuild(db: DbExecutor, guildId: string): Promise<void> {
  await db
    .insert(guilds)
    .values({ id: guildId, name: '', ownerId: '' })
    .onConflictDoNothing({ target: guilds.id });
}

// ── tipos ───────────────────────────────────────────────────────────────────

export interface CreateTicketTypeInput {
  guildId: string;
  name: string;
  categoryId: string;
  supportRoleIds?: string[];
  openingMessage?: MessageTemplate | null;
  maxOpenPerUser?: number | null;
  namingPattern?: string | null;
}

export async function listTicketTypes(db: DbExecutor, guildId: string): Promise<TicketType[]> {
  return db
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.guildId, guildId))
    .orderBy(asc(ticketTypes.name));
}

export async function getTicketType(
  db: DbExecutor,
  guildId: string,
  typeId: string,
): Promise<TicketType | null> {
  const [row] = await db
    .select()
    .from(ticketTypes)
    .where(and(eq(ticketTypes.guildId, guildId), eq(ticketTypes.id, typeId)))
    .limit(1);
  return row ?? null;
}

/** `null` quando já existe um tipo com o mesmo nome na guild. */
export async function createTicketType(
  db: DbExecutor,
  input: CreateTicketTypeInput,
): Promise<TicketType | null> {
  await ensureGuild(db, input.guildId);
  const [row] = await db
    .insert(ticketTypes)
    .values(input)
    .onConflictDoNothing({ target: [ticketTypes.guildId, ticketTypes.name] })
    .returning();
  return row ?? null;
}

export type UpdateTicketTypeInput = Partial<Omit<CreateTicketTypeInput, 'guildId'>>;

/** `null` quando o tipo sumiu ou o novo nome já existe na guild. */
export async function updateTicketType(
  db: DbExecutor,
  guildId: string,
  typeId: string,
  input: UpdateTicketTypeInput,
): Promise<TicketType | null> {
  const [row] = await db
    .update(ticketTypes)
    .set({ ...input, updatedAt: sql`now()` })
    .where(and(eq(ticketTypes.guildId, guildId), eq(ticketTypes.id, typeId)))
    .returning();
  return row ?? null;
}

export async function deleteTicketType(
  db: DbExecutor,
  guildId: string,
  typeId: string,
): Promise<TicketType | null> {
  const [row] = await db
    .delete(ticketTypes)
    .where(and(eq(ticketTypes.guildId, guildId), eq(ticketTypes.id, typeId)))
    .returning();
  return row ?? null;
}

// ── painéis ─────────────────────────────────────────────────────────────────

export interface CreateTicketPanelInput {
  guildId: string;
  channelId: string;
  content: MessageTemplate;
  typeIds: string[];
}

export async function listTicketPanels(db: DbExecutor, guildId: string): Promise<TicketPanel[]> {
  return db
    .select()
    .from(ticketPanels)
    .where(eq(ticketPanels.guildId, guildId))
    .orderBy(asc(ticketPanels.createdAt));
}

export async function getTicketPanel(
  db: DbExecutor,
  guildId: string,
  panelId: string,
): Promise<TicketPanel | null> {
  const [row] = await db
    .select()
    .from(ticketPanels)
    .where(and(eq(ticketPanels.guildId, guildId), eq(ticketPanels.id, panelId)))
    .limit(1);
  return row ?? null;
}

export async function createTicketPanel(
  db: DbExecutor,
  input: CreateTicketPanelInput,
): Promise<TicketPanel> {
  await ensureGuild(db, input.guildId);
  const [row] = await db.insert(ticketPanels).values(input).returning();
  if (!row) throw new Error('INSERT em ticket_panels não retornou linha');
  return row;
}

export interface UpdateTicketPanelInput {
  channelId?: string;
  content?: MessageTemplate;
  typeIds?: string[];
}

export async function updateTicketPanel(
  db: DbExecutor,
  guildId: string,
  panelId: string,
  input: UpdateTicketPanelInput,
): Promise<TicketPanel | null> {
  const [row] = await db
    .update(ticketPanels)
    .set({ ...input, updatedAt: sql`now()` })
    .where(and(eq(ticketPanels.guildId, guildId), eq(ticketPanels.id, panelId)))
    .returning();
  return row ?? null;
}

/** Esquece a mensagem publicada (o painel volta a ser rascunho). */
export async function clearTicketPanelMessage(
  db: DbExecutor,
  panelId: string,
): Promise<TicketPanel | null> {
  const [row] = await db
    .update(ticketPanels)
    .set({ messageId: null, updatedAt: sql`now()` })
    .where(eq(ticketPanels.id, panelId))
    .returning();
  return row ?? null;
}

export async function getTicket(
  db: DbExecutor,
  guildId: string,
  ticketId: number,
): Promise<Ticket | null> {
  const [row] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.guildId, guildId), eq(tickets.id, ticketId)))
    .limit(1);
  return row ?? null;
}

export async function setTicketPanelMessage(
  db: DbExecutor,
  panelId: string,
  channelId: string,
  messageId: string,
): Promise<TicketPanel | null> {
  const [row] = await db
    .update(ticketPanels)
    .set({ channelId, messageId, updatedAt: sql`now()` })
    .where(eq(ticketPanels.id, panelId))
    .returning();
  return row ?? null;
}

export async function deleteTicketPanel(
  db: DbExecutor,
  guildId: string,
  panelId: string,
): Promise<TicketPanel | null> {
  const [row] = await db
    .delete(ticketPanels)
    .where(and(eq(ticketPanels.guildId, guildId), eq(ticketPanels.id, panelId)))
    .returning();
  return row ?? null;
}

// ── tickets ─────────────────────────────────────────────────────────────────

export type TicketOpeningReservation =
  { reserved: true; id: string; number: number } | { reserved: false; open: number };

/**
 * Serializa a contagem por usuário sem manter a transação aberta durante uma
 * chamada ao Discord. Reservas ativas já consomem vagas; expiradas não.
 */
export async function reserveTicketOpening(
  db: Db,
  input: { guildId: string; userId: string; typeId: string; limit: number },
): Promise<TicketOpeningReservation> {
  await ensureGuild(db, input.guildId);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${input.guildId}:${input.userId}`}, 0))`,
    );
    // Uma instrução, um snapshot: confirmação concorrente troca reserva por
    // ticket sem deixar uma janela em que a soma pareça zero.
    const [counts] = await tx
      .select({
        count: sql<number>`(
          (select count(*) from ${tickets}
           where ${tickets.guildId} = ${input.guildId}
             and ${tickets.userId} = ${input.userId}
             and ${tickets.status} = 'open')
          +
          (select count(*) from ${ticketOpenReservations}
           where ${ticketOpenReservations.guildId} = ${input.guildId}
             and ${ticketOpenReservations.userId} = ${input.userId}
             and ${ticketOpenReservations.expiresAt} > now())
        )::int`,
      })
      .from(guilds)
      .where(eq(guilds.id, input.guildId));
    const open = counts?.count ?? 0;
    if (open >= input.limit) return { reserved: false, open };

    const [counter] = await tx
      .insert(ticketCounters)
      .values({
        guildId: input.guildId,
        lastNumber: sql<number>`(
          select coalesce(max(${tickets.number}), 0) + 1
          from ${tickets}
          where ${tickets.guildId} = ${input.guildId}
        )`,
      })
      .onConflictDoUpdate({
        target: ticketCounters.guildId,
        set: { lastNumber: sql<number>`${ticketCounters.lastNumber} + 1` },
      })
      .returning({ number: ticketCounters.lastNumber });
    if (!counter) throw new Error('Contador de tickets não retornou número');

    const [reservation] = await tx
      .insert(ticketOpenReservations)
      .values({
        guildId: input.guildId,
        userId: input.userId,
        typeId: input.typeId,
        number: counter.number,
        expiresAt: sql<Date>`now() + interval '10 minutes'`,
      })
      .returning({ id: ticketOpenReservations.id });
    if (!reservation) throw new Error('Reserva de ticket não retornou id');
    return { reserved: true, id: reservation.id, number: counter.number };
  });
}

/** Finaliza a reserva e ocupa a vaga na mesma transação. */
export async function confirmTicketOpening(
  db: Db,
  reservationId: string,
  channelId: string,
): Promise<Ticket | null> {
  return db.transaction(async (tx) => {
    const [reservation] = await tx
      .select()
      .from(ticketOpenReservations)
      .where(
        and(
          eq(ticketOpenReservations.id, reservationId),
          gt(ticketOpenReservations.expiresAt, sql`now()`),
        ),
      )
      .for('update')
      .limit(1);
    if (!reservation) return null;

    const [ticket] = await tx
      .insert(tickets)
      .values({
        guildId: reservation.guildId,
        typeId: reservation.typeId,
        userId: reservation.userId,
        channelId,
        number: reservation.number,
      })
      .returning();
    if (!ticket) throw new Error('INSERT em tickets não retornou linha');
    await tx.delete(ticketOpenReservations).where(eq(ticketOpenReservations.id, reservationId));
    return ticket;
  });
}

export async function releaseTicketOpening(db: DbExecutor, reservationId: string): Promise<void> {
  await db.delete(ticketOpenReservations).where(eq(ticketOpenReservations.id, reservationId));
}

export async function cleanupExpiredTicketOpenings(
  db: DbExecutor,
  guildId: string,
  at: Date = new Date(),
): Promise<number> {
  const rows = await db
    .delete(ticketOpenReservations)
    .where(
      and(eq(ticketOpenReservations.guildId, guildId), lte(ticketOpenReservations.expiresAt, at)),
    )
    .returning({ id: ticketOpenReservations.id });
  return rows.length;
}

export async function countOpenTickets(
  db: DbExecutor,
  guildId: string,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(
      and(eq(tickets.guildId, guildId), eq(tickets.userId, userId), eq(tickets.status, 'open')),
    );
  return row?.count ?? 0;
}

export async function getTicketByChannel(
  db: DbExecutor,
  channelId: string,
): Promise<Ticket | null> {
  const [row] = await db.select().from(tickets).where(eq(tickets.channelId, channelId)).limit(1);
  return row ?? null;
}

/** Quantos tickets a guild tem em cada estado — o stat tile do dashboard. */
export async function countTicketsByStatus(
  db: DbExecutor,
  guildId: string,
  status: 'open' | 'closed',
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(and(eq(tickets.guildId, guildId), eq(tickets.status, status)));
  return row?.count ?? 0;
}

export async function listTickets(
  db: DbExecutor,
  guildId: string,
  options: { status?: 'open' | 'closed'; limit?: number } = {},
): Promise<Ticket[]> {
  const where = options.status
    ? and(eq(tickets.guildId, guildId), eq(tickets.status, options.status))
    : eq(tickets.guildId, guildId);
  return db
    .select()
    .from(tickets)
    .where(where)
    .orderBy(desc(tickets.number))
    .limit(options.limit ?? 50);
}

/** Tickets mais antigos primeiro, com limite para não varrer a guild inteira. */
export async function listInactiveTickets(
  db: DbExecutor,
  guildId: string,
  inactiveBefore: Date,
  limit = 100,
): Promise<Ticket[]> {
  return db
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.guildId, guildId),
        eq(tickets.status, 'open'),
        lte(tickets.lastActivityAt, inactiveBefore),
      ),
    )
    .orderBy(asc(tickets.lastActivityAt))
    .limit(limit);
}

/** Um UPDATE por mensagem de ticket; ignora mensagens fora do ticket. */
export async function touchTicketActivity(
  db: DbExecutor,
  channelId: string,
  at: Date,
): Promise<boolean> {
  const [row] = await db
    .update(tickets)
    .set({ lastActivityAt: at })
    .where(
      and(
        eq(tickets.channelId, channelId),
        eq(tickets.status, 'open'),
        lt(tickets.lastActivityAt, at),
      ),
    )
    .returning({ id: tickets.id });
  if (row) return true;
  const [existing] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.channelId, channelId), eq(tickets.status, 'open')))
    .limit(1);
  return !!existing;
}

/** `null` quando alguém já assumiu — o botão `Assumir` é de todo o suporte. */
export async function claimTicket(
  db: DbExecutor,
  ticketId: number,
  claimedBy: string,
): Promise<Ticket | null> {
  const [row] = await db
    .update(tickets)
    .set({ claimedBy })
    .where(
      and(eq(tickets.id, ticketId), eq(tickets.status, 'open'), sql`${tickets.claimedBy} is null`),
    )
    .returning();
  return row ?? null;
}

/** `null` quando o ticket já estava fechado (dois cliques em `Fechar`). */
export async function closeTicket(
  db: DbExecutor,
  ticketId: number,
  input: { closedBy: string; reason: string | null; inactiveBefore?: Date },
): Promise<Ticket | null> {
  const [row] = await db
    .update(tickets)
    .set({
      status: 'closed',
      closedBy: input.closedBy,
      closeReason: input.reason,
      closedAt: sql`now()`,
    })
    .where(
      and(
        eq(tickets.id, ticketId),
        eq(tickets.status, 'open'),
        input.inactiveBefore ? lte(tickets.lastActivityAt, input.inactiveBefore) : undefined,
      ),
    )
    .returning();
  return row ?? null;
}

export async function setTicketTranscript(
  db: DbExecutor,
  ticketId: number,
  transcriptUrl: string,
): Promise<void> {
  await db.update(tickets).set({ transcriptUrl }).where(eq(tickets.id, ticketId));
}
