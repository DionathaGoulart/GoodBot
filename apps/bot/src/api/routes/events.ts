import {
  ActorInputSchema,
  EVENT_ENTITY_TYPES,
  ScheduledEventInputSchema,
  UserFacingError,
  scheduledEventProblems,
} from '@cobot/shared';
import { ChannelType } from 'discord.js';
import { Hono } from 'hono';

import { requireActor } from '../actor';
import { ApiHttpError, forbidden, notFound } from '../errors';
import { validate } from '../validate';

import type { ApiDeps, ApiEnv } from '../context';
import type { GuildScheduledEventSummary, ScheduledEventInput } from '@cobot/shared';
import type {
  Guild,
  GuildScheduledEvent,
  GuildScheduledEventCreateOptions,
  GuildScheduledEventEntityType,
} from 'discord.js';

/** Canais onde um evento do Discord pode acontecer. */
const EVENT_CHANNEL_TYPES: ChannelType[] = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];

function toEventSummary(event: GuildScheduledEvent): GuildScheduledEventSummary {
  return {
    id: event.id,
    name: event.name,
    description: event.description,
    entityType: event.entityType,
    status: event.status,
    channelId: event.channelId,
    channelName: event.channel?.name ?? null,
    location: event.entityMetadata?.location ?? null,
    scheduledStartAt: (event.scheduledStartAt ?? new Date()).toISOString(),
    scheduledEndAt: event.scheduledEndAt?.toISOString() ?? null,
    coverUrl: event.coverImageURL({ size: 512 }),
    userCount: event.userCount,
    creator: event.creator
      ? {
          id: event.creator.id,
          username: event.creator.tag,
          avatarUrl: event.creator.displayAvatarURL({ size: 64 }),
        }
      : null,
    url: event.url,
  };
}

function canManageEvents(guild: Guild): boolean {
  return guild.members.me?.permissions.has('ManageEvents') ?? false;
}

function requireManageEvents(guild: Guild): void {
  if (canManageEvents(guild)) return;
  throw forbidden(
    'O bot não tem a permissão Gerenciar Eventos; reconvide-o com ela.',
    'MISSING_MANAGE_EVENTS',
  );
}

/**
 * As regras cruzadas (externo exige local e fim, voz exige canal) já rodam no
 * schema; repetimos a chamada aqui porque a mensagem por campo é o que o
 * painel mostra, e o Discord devolveria só um 400 sem explicação.
 */
function assertConsistent(input: ScheduledEventInput): void {
  const problems = scheduledEventProblems(input);
  if (problems.length === 0) return;
  throw new ApiHttpError(
    400,
    'BAD_EVENT',
    problems.map((problem) => problem.message).join(' '),
    problems.map((problem) => ({ path: problem.field, message: problem.message })),
  );
}

/** O canal do evento, já checado como voz ou palco. */
function resolveEventChannel(guild: Guild, input: ScheduledEventInput): string | undefined {
  if (input.entityType === EVENT_ENTITY_TYPES.external) return undefined;
  const channel = input.channelId ? guild.channels.cache.get(input.channelId) : undefined;
  if (!channel || !EVENT_CHANNEL_TYPES.includes(channel.type)) {
    throw new UserFacingError('O evento precisa de um canal de voz ou de palco.', {
      code: 'BAD_EVENT_CHANNEL',
    });
  }
  return channel.id;
}

/** O corpo comum de criar e editar; `image` só entra quando o painel mexeu nela. */
function toDiscordOptions(
  guild: Guild,
  input: ScheduledEventInput,
  reason: string,
): GuildScheduledEventCreateOptions {
  const external = input.entityType === EVENT_ENTITY_TYPES.external;
  return {
    name: input.name,
    description: input.description ?? undefined,
    scheduledStartTime: input.scheduledStartAt,
    scheduledEndTime: input.scheduledEndAt ?? undefined,
    // `GuildOnly` é o único valor que o Discord aceita hoje.
    privacyLevel: 2,
    entityType: input.entityType as GuildScheduledEventEntityType,
    channel: resolveEventChannel(guild, input),
    entityMetadata: external ? { location: input.location ?? '' } : undefined,
    ...(input.image === undefined ? {} : { image: input.image }),
    reason,
  } as GuildScheduledEventCreateOptions;
}

async function requireEvent(guild: Guild, eventId: string): Promise<GuildScheduledEvent> {
  const event = await guild.scheduledEvents.fetch(eventId).catch(() => null);
  if (!event) throw notFound('Evento não encontrado.', 'EVENT_NOT_FOUND');
  return event;
}

/**
 * Eventos agendados pelo painel (PRD §6.3). Como os convites, tudo por REST:
 * o `GuildScheduledEventManager` está com cache 0 (§7.2).
 */
export function createEventRoutes(deps: ApiDeps): Hono<ApiEnv> {
  return new Hono<ApiEnv>()
    .get('/', async (c) => {
      const guild = c.get('guild');
      const events = await guild.scheduledEvents.fetch();
      const list = [...events.values()]
        .map(toEventSummary)
        .sort((a, b) => a.scheduledStartAt.localeCompare(b.scheduledStartAt));
      return c.json({ events: list, canManage: canManageEvents(guild) });
    })

    .post('/', validate('json', ScheduledEventInputSchema), async (c) => {
      const input = c.req.valid('json');
      const guild = c.get('guild');
      const actor = await requireActor(deps, guild, input.actorId, 'admin');
      requireManageEvents(guild);
      assertConsistent(input);

      const created = await guild.scheduledEvents.create(
        toDiscordOptions(guild, input, input.reason ?? `Criado pelo painel por ${actor.user.tag}`),
      );
      return c.json(toEventSummary(created));
    })

    .patch('/:eventId', validate('json', ScheduledEventInputSchema), async (c) => {
      const input = c.req.valid('json');
      const guild = c.get('guild');
      const actor = await requireActor(deps, guild, input.actorId, 'admin');
      requireManageEvents(guild);
      assertConsistent(input);

      const event = await requireEvent(guild, c.req.param('eventId'));
      const edited = await event.edit(
        toDiscordOptions(guild, input, input.reason ?? `Editado pelo painel por ${actor.user.tag}`),
      );
      return c.json(toEventSummary(edited));
    })

    .delete('/:eventId', validate('json', ActorInputSchema), async (c) => {
      const input = c.req.valid('json');
      const guild = c.get('guild');
      await requireActor(deps, guild, input.actorId, 'admin');
      requireManageEvents(guild);

      const event = await requireEvent(guild, c.req.param('eventId'));
      await event.delete();
      return c.json({ ok: true as const });
    });
}
