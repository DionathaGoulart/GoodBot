import 'server-only';

import {
  createTicketPanel,
  createTicketType,
  deleteTicketPanel,
  deleteTicketType,
  getTicketPanel,
  getTicketType,
  listTicketPanels,
  listTicketTypes,
  listTickets,
  updateTicketPanel,
  updateTicketType,
} from '@goodbot/db';
import {
  TicketPanelInputSchema,
  TicketTypeInputSchema,
  type TicketPanelInput,
  type TicketTypeInput,
} from '@goodbot/shared';
import { revalidatePath } from 'next/cache';

import { withAudit } from './audit';
import { defaultGuildId, requireGuildAccess } from './auth/require';
import { db } from './db';
import { internalApi } from './internal-api';
import { toFieldErrors, type ActionResult } from './module-config';

const PATH = (guildId: string) => `/g/${guildId}/config/tickets`;
/** Teto da aba `Tickets`: a tabela pagina no cliente. */
const TICKET_LIST_LIMIT = 200;

export type TicketTypeRow = TicketTypeInput & {
  id: string;
};

export type TicketPanelRow = TicketPanelInput & {
  id: string;
  messageId: string | null;
};

export type TicketRow = {
  id: number;
  number: number;
  typeId: string | null;
  userId: string;
  channelId: string;
  status: 'open' | 'closed';
  claimedBy: string | null;
  transcriptUrl: string | null;
  openedAt: string;
  closedAt: string | null;
};

export async function loadTicketTypes(guildId: string): Promise<TicketTypeRow[]> {
  const rows = await listTicketTypes(db(), guildId);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    categoryId: row.categoryId,
    supportRoleIds: row.supportRoleIds,
    openingMessage: row.openingMessage,
    maxOpenPerUser: row.maxOpenPerUser,
    namingPattern: row.namingPattern,
  }));
}

export async function loadTicketPanels(guildId: string): Promise<TicketPanelRow[]> {
  const rows = await listTicketPanels(db(), guildId);
  return rows.map((row) => ({
    id: row.id,
    channelId: row.channelId,
    messageId: row.messageId,
    content: row.content,
    typeIds: row.typeIds,
  }));
}

/** Datas viram ISO: o client component não recebe `Date`. */
export async function loadTickets(guildId: string): Promise<TicketRow[]> {
  const rows = await listTickets(db(), guildId, { limit: TICKET_LIST_LIMIT });
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    typeId: row.typeId,
    userId: row.userId,
    channelId: row.channelId,
    status: row.status,
    claimedBy: row.claimedBy,
    transcriptUrl: row.transcriptUrl,
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
  }));
}

function parseBody(raw: FormDataEntryValue | null): unknown {
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function idFrom(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// ── tipos ───────────────────────────────────────────────────────────────────

export async function saveTicketType(formData: FormData): Promise<ActionResult> {
  const guildId = await defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const parsed = TicketTypeInputSchema.safeParse(parseBody(formData.get('type')));
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Confira os campos marcados.',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }
  const input = parsed.data;
  const typeId = idFrom(formData, 'typeId');

  const before = typeId ? await getTicketType(db(), guildId, typeId) : null;
  if (typeId && !before) return { ok: false, message: 'Esse tipo não existe mais.' };

  const saved = typeId
    ? await updateTicketType(db(), guildId, typeId, input)
    : await createTicketType(db(), { guildId, ...input });
  if (!saved) {
    return {
      ok: false,
      message: 'Já existe um tipo com esse nome.',
      fieldErrors: { name: 'Nome em uso' },
    };
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    typeId ? 'tickets.type.update' : 'tickets.type.create',
    { type: 'ticket_type', id: saved.id },
    before,
    saved,
  );
  revalidatePath(PATH(guildId));
  return { ok: true };
}

export async function removeTicketType(formData: FormData): Promise<ActionResult> {
  const guildId = await defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const typeId = idFrom(formData, 'typeId');
  if (!typeId) return { ok: false, message: 'Tipo inválido.' };

  const removed = await deleteTicketType(db(), guildId, typeId);
  if (!removed) return { ok: false, message: 'Esse tipo não existe mais.' };

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    'tickets.type.delete',
    { type: 'ticket_type', id: typeId },
    removed,
    null,
  );
  revalidatePath(PATH(guildId));
  return { ok: true };
}

// ── painel ──────────────────────────────────────────────────────────────────

export async function saveTicketPanel(formData: FormData): Promise<ActionResult> {
  const guildId = await defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const parsed = TicketPanelInputSchema.safeParse(parseBody(formData.get('panel')));
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Confira os campos marcados.',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }
  const input = parsed.data;
  const id = idFrom(formData, 'panelId');

  const before = id ? await getTicketPanel(db(), guildId, id) : null;
  if (id && !before) return { ok: false, message: 'Esse painel não existe mais.' };

  const panel = id
    ? await updateTicketPanel(db(), guildId, id, input)
    : await createTicketPanel(db(), { guildId, ...input });
  if (!panel) return { ok: false, message: 'Esse painel não existe mais.' };

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    id ? 'tickets.panel.update' : 'tickets.panel.create',
    { type: 'ticket_panel', id: panel.id },
    before,
    input,
  );
  revalidatePath(PATH(guildId));
  return { ok: true };
}

export async function publishTicketPanel(formData: FormData): Promise<ActionResult> {
  const guildId = await defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const id = idFrom(formData, 'panelId');
  if (!id) return { ok: false, message: 'Painel inválido.' };

  try {
    await internalApi().publishTicketPanel(guildId, id);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'O bot não respondeu.' };
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    'tickets.panel.publish',
    {
      type: 'ticket_panel',
      id,
    },
  );
  revalidatePath(PATH(guildId));
  return { ok: true, message: 'Painel publicado.' };
}

export async function removeTicketPanel(formData: FormData): Promise<ActionResult> {
  const guildId = await defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const id = idFrom(formData, 'panelId');
  if (!id) return { ok: false, message: 'Painel inválido.' };

  const before = await getTicketPanel(db(), guildId, id);
  if (!before) return { ok: false, message: 'Esse painel não existe mais.' };

  let warning: string | undefined;
  if (before.messageId) {
    try {
      await internalApi().unpublishTicketPanel(guildId, id);
    } catch {
      warning = 'Painel removido, mas a mensagem no Discord pode ter ficado. Apague-a à mão.';
    }
  }

  if (!(await deleteTicketPanel(db(), guildId, id))) {
    return { ok: false, message: 'Esse painel não existe mais.' };
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    'tickets.panel.delete',
    { type: 'ticket_panel', id },
    before,
    null,
  );
  revalidatePath(PATH(guildId));
  return warning ? { ok: true, message: warning } : { ok: true };
}

// ── tickets ─────────────────────────────────────────────────────────────────

/**
 * `FECHAR` da tabela. Quem fecha é o bot, pelo mesmo caminho do botão dentro
 * do Discord: transcript, log e apagamento do canal saem idênticos.
 */
export async function closeTicketAction(formData: FormData): Promise<ActionResult> {
  const guildId = await defaultGuildId();
  const session = await requireGuildAccess(guildId, 'mod');

  const raw = formData.get('ticketId');
  const ticketId = Number(raw);
  if (typeof raw !== 'string' || !Number.isInteger(ticketId)) {
    return { ok: false, message: 'Ticket inválido.' };
  }
  const reason = formData.get('reason');

  try {
    await internalApi().closeTicket(guildId, ticketId, {
      actorId: session.user.id,
      reason: typeof reason === 'string' && reason.length > 0 ? reason : null,
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'O bot não respondeu.' };
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    'tickets.close',
    {
      type: 'ticket',
      id: String(ticketId),
    },
  );
  revalidatePath(PATH(guildId));
  return { ok: true, message: 'Ticket fechado.' };
}
