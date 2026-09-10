import 'server-only';

import { ActorInputSchema, ScheduledEventInputSchema } from '@goodbot/shared';
import { revalidatePath } from 'next/cache';

import { failure } from './action-error';
import { withAudit } from './audit';
import { defaultGuildId, requireGuildAccess } from './auth/require';
import { internalApi } from './internal-api';
import { toFieldErrors, type ActionResult } from './module-config';

import type { GuildScheduledEventList, GuildScheduledEventSummary } from '@goodbot/shared';

const PATH = (guildId: string) => `/g/${guildId}/eventos`;

export async function loadScheduledEvents(
  guildId: string,
): Promise<{ list: GuildScheduledEventList | null; error: string | null }> {
  try {
    return { list: await internalApi().scheduledEvents(guildId), error: null };
  } catch (error) {
    return { list: null, error: failure(error).message ?? 'O bot não respondeu.' };
  }
}

function parseBody(raw: FormDataEntryValue | null): unknown {
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * O recorte que vai para o diff da auditoria. A capa entra como URL do CDN,
 * nunca como a data URL: uma linha de `jsonb` de 8 MB seria um jeito caro de
 * guardar uma imagem que o Discord já hospeda.
 */
function auditable(event: GuildScheduledEventSummary) {
  return {
    id: event.id,
    name: event.name,
    description: event.description,
    entityType: event.entityType,
    status: event.status,
    channelId: event.channelId,
    location: event.location,
    scheduledStartAt: event.scheduledStartAt,
    scheduledEndAt: event.scheduledEndAt,
    coverUrl: event.coverUrl,
  };
}

/** Cria (sem `eventId`) ou edita (com) um evento agendado (§6.3). */
export async function saveScheduledEvent(formData: FormData): Promise<ActionResult> {
  const guildId = defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const eventIdValue = formData.get('eventId');
  const eventId = typeof eventIdValue === 'string' && eventIdValue !== '' ? eventIdValue : null;

  const raw = parseBody(formData.get('event'));
  const parsed = ScheduledEventInputSchema.safeParse(
    typeof raw === 'object' && raw !== null ? { ...raw, actorId: session.user.id } : raw,
  );
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Confira os campos marcados.',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }

  // O estado anterior só existe antes da edição: sem ele a auditoria mostraria
  // a troca de horário sem dizer qual era o horário.
  const before = eventId ? await findEvent(guildId, eventId) : null;

  let saved: GuildScheduledEventSummary;
  try {
    saved = eventId
      ? await internalApi().updateScheduledEvent(guildId, eventId, parsed.data)
      : await internalApi().createScheduledEvent(guildId, parsed.data);
  } catch (error) {
    return failure(error, 'O bot não respondeu; o evento não mudou.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    eventId ? 'event.update' : 'event.create',
    { type: 'event', id: saved.id },
    before && auditable(before),
    auditable(saved),
  );

  revalidatePath(PATH(guildId));
  return { ok: true, message: eventId ? 'Evento atualizado.' : 'Evento criado.' };
}

export async function deleteScheduledEvent(formData: FormData): Promise<ActionResult> {
  const guildId = defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const eventId = formData.get('eventId');
  if (typeof eventId !== 'string' || eventId === '') {
    return { ok: false, message: 'Evento inválido.' };
  }

  const parsed = ActorInputSchema.safeParse({ actorId: session.user.id });
  if (!parsed.success) return { ok: false, message: 'Sessão inválida.' };

  const before = await findEvent(guildId, eventId);

  try {
    await internalApi().deleteScheduledEvent(guildId, eventId, parsed.data);
  } catch (error) {
    return failure(error, 'O bot não respondeu; o evento continua marcado.');
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    'event.delete',
    { type: 'event', id: eventId },
    before && auditable(before),
    null,
  );

  revalidatePath(PATH(guildId));
  return { ok: true, message: 'Evento cancelado.' };
}

/** O evento como está agora; `null` quando sumiu ou o bot não respondeu. */
async function findEvent(
  guildId: string,
  eventId: string,
): Promise<GuildScheduledEventSummary | null> {
  const { list } = await loadScheduledEvents(guildId);
  return list?.events.find((event) => event.id === eventId) ?? null;
}
