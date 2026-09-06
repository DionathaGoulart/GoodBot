import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { ticketPanels, ticketTypes, tickets } from '../schema/community';
import { guilds } from '../schema/guilds';

import type { DbExecutor } from '../client';
import type { Ticket, TicketPanel, TicketType } from '../types';
import type { MessageTemplate } from '@cobot/shared';

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

export interface CreateTicketInput {
  guildId: string;
  typeId: string | null;
  userId: string;
  channelId: string;
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
      and(
        eq(tickets.guildId, guildId),
        eq(tickets.userId, userId),
        eq(tickets.status, 'open'),
      ),
    );
  return row?.count ?? 0;
}

/**
 * Reserva o próximo número da guild na própria `INSERT`, para dois cliques
 * simultâneos não pegarem o mesmo. O índice único `(guild_id, number)` é a
 * garantia final; o chamador repete quando ele estoura.
 */
export async function createTicket(db: DbExecutor, input: CreateTicketInput): Promise<Ticket> {
  const [row] = await db
    .insert(tickets)
    .values({
      ...input,
      number: sql<number>`(
        select coalesce(max(${tickets.number}), 0) + 1
        from ${tickets}
        where ${tickets.guildId} = ${input.guildId}
      )`,
    })
    .returning();
  if (!row) throw new Error('INSERT em tickets não retornou linha');
  return row;
}

export async function getTicketByChannel(
  db: DbExecutor,
  channelId: string,
): Promise<Ticket | null> {
  const [row] = await db.select().from(tickets).where(eq(tickets.channelId, channelId)).limit(1);
  return row ?? null;
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

/** `null` quando alguém já assumiu — o botão `Assumir` é de todo o suporte. */
export async function claimTicket(
  db: DbExecutor,
  ticketId: number,
  claimedBy: string,
): Promise<Ticket | null> {
  const [row] = await db
    .update(tickets)
    .set({ claimedBy })
    .where(and(eq(tickets.id, ticketId), sql`${tickets.claimedBy} is null`))
    .returning();
  return row ?? null;
}

/** `null` quando o ticket já estava fechado (dois cliques em `Fechar`). */
export async function closeTicket(
  db: DbExecutor,
  ticketId: number,
  input: { closedBy: string; reason: string | null },
): Promise<Ticket | null> {
  const [row] = await db
    .update(tickets)
    .set({
      status: 'closed',
      closedBy: input.closedBy,
      closeReason: input.reason,
      closedAt: sql`now()`,
    })
    .where(and(eq(tickets.id, ticketId), eq(tickets.status, 'open')))
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
