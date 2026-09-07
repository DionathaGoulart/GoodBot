import { z } from 'zod';

import { GuildImageSchema } from './guild';
import { actorFields } from './roles';
import { SnowflakeSchema, emptyToNull } from '../config/common';

/**
 * Eventos agendados (PRD §6.3). Os números são os do Discord
 * (`GuildScheduledEventEntityType` e `GuildScheduledEventStatus`); ficam aqui
 * como literais para o painel não depender do `discord.js`, que é do bot.
 */
export const EVENT_ENTITY_TYPES = { stageInstance: 1, voice: 2, external: 3 } as const;
export type EventEntityType = (typeof EVENT_ENTITY_TYPES)[keyof typeof EVENT_ENTITY_TYPES];

export const EventEntityTypeSchema = z.union([
  z.literal(EVENT_ENTITY_TYPES.stageInstance),
  z.literal(EVENT_ENTITY_TYPES.voice),
  z.literal(EVENT_ENTITY_TYPES.external),
]);

export const EVENT_ENTITY_TYPE_LABEL: Record<EventEntityType, string> = {
  [EVENT_ENTITY_TYPES.stageInstance]: 'PALCO',
  [EVENT_ENTITY_TYPES.voice]: 'CANAL DE VOZ',
  [EVENT_ENTITY_TYPES.external]: 'FORA DO DISCORD',
};

export const EVENT_STATUS = { scheduled: 1, active: 2, completed: 3, canceled: 4 } as const;
export type EventStatus = (typeof EVENT_STATUS)[keyof typeof EVENT_STATUS];

export const EVENT_STATUS_LABEL: Record<number, string> = {
  [EVENT_STATUS.scheduled]: 'AGENDADO',
  [EVENT_STATUS.active]: 'ATIVO',
  [EVENT_STATUS.completed]: 'ENCERRADO',
  [EVENT_STATUS.canceled]: 'CANCELADO',
};

export const MAX_EVENT_NAME_LENGTH = 100;
export const MAX_EVENT_DESCRIPTION_LENGTH = 1000;
export const MAX_EVENT_LOCATION_LENGTH = 100;

const EventBaseSchema = z.object({
  ...actorFields,
  name: z.string().trim().min(1).max(MAX_EVENT_NAME_LENGTH),
  description: emptyToNull(z.string().trim().max(MAX_EVENT_DESCRIPTION_LENGTH)),
  entityType: EventEntityTypeSchema,
  /** Canal de voz ou palco; `null` quando o evento é externo. */
  channelId: emptyToNull(SnowflakeSchema),
  /** Endereço livre; só existe (e é obrigatório) no evento externo. */
  location: emptyToNull(z.string().trim().max(MAX_EVENT_LOCATION_LENGTH)),
  scheduledStartAt: z.iso.datetime(),
  /** Obrigatório no evento externo; opcional nos outros. */
  scheduledEndAt: emptyToNull(z.iso.datetime()),
  /** Capa: ausente = não mexer, `null` = remover, data URL = trocar. */
  image: GuildImageSchema.nullable().optional(),
});

/** O que o formulário manda, antes de qualquer validação cruzada. */
export type ScheduledEventDraft = z.input<typeof EventBaseSchema>;

export interface EventProblem {
  field: 'channelId' | 'location' | 'scheduledEndAt' | 'scheduledStartAt';
  message: string;
}

/**
 * As regras que o Discord só conta com um 400 genérico. Pura de propósito: o
 * formulário do painel e a rota do bot chamam a mesma função, então o que a
 * tela marca em vermelho é exatamente o que a API recusaria.
 */
export function scheduledEventProblems(input: {
  entityType: number;
  channelId: string | null;
  location: string | null;
  scheduledStartAt: string;
  scheduledEndAt: string | null;
}): EventProblem[] {
  const problems: EventProblem[] = [];
  const external = input.entityType === EVENT_ENTITY_TYPES.external;

  if (external) {
    if (!input.location) {
      problems.push({ field: 'location', message: 'Evento fora do Discord precisa de um local.' });
    }
    if (!input.scheduledEndAt) {
      problems.push({
        field: 'scheduledEndAt',
        message: 'Evento fora do Discord precisa de data de fim.',
      });
    }
  } else if (!input.channelId) {
    problems.push({ field: 'channelId', message: 'Escolha o canal de voz ou palco do evento.' });
  }

  const start = Date.parse(input.scheduledStartAt);
  const end = input.scheduledEndAt === null ? null : Date.parse(input.scheduledEndAt);
  if (end !== null && Number.isFinite(start) && Number.isFinite(end) && end <= start) {
    problems.push({ field: 'scheduledEndAt', message: 'O fim tem que vir depois do início.' });
  }

  return problems;
}

/** `POST`/`PATCH /guilds/:id/events` — criar e editar evento agendado. */
export const ScheduledEventInputSchema = EventBaseSchema.superRefine((input, ctx) => {
  for (const problem of scheduledEventProblems(input)) {
    ctx.addIssue({ code: 'custom', path: [problem.field], message: problem.message });
  }
});
export type ScheduledEventInput = z.infer<typeof ScheduledEventInputSchema>;

export const GuildScheduledEventSummarySchema = z.object({
  id: SnowflakeSchema,
  name: z.string(),
  description: z.string().nullable(),
  entityType: z.number().int(),
  status: z.number().int(),
  channelId: SnowflakeSchema.nullable(),
  channelName: z.string().nullable(),
  location: z.string().nullable(),
  scheduledStartAt: z.iso.datetime(),
  scheduledEndAt: z.iso.datetime().nullable(),
  coverUrl: z.url().nullable(),
  /** Quantos clicaram em "interessado"; `null` quando o Discord não conta. */
  userCount: z.number().int().min(0).nullable(),
  creator: z
    .object({ id: SnowflakeSchema, username: z.string(), avatarUrl: z.url().nullable() })
    .nullable(),
  url: z.string(),
});
export type GuildScheduledEventSummary = z.infer<typeof GuildScheduledEventSummarySchema>;

export const GuildScheduledEventListSchema = z.object({
  events: z.array(GuildScheduledEventSummarySchema),
  /** `false` quando falta `ManageEvents` ao bot. */
  canManage: z.boolean(),
});
export type GuildScheduledEventList = z.infer<typeof GuildScheduledEventListSchema>;
