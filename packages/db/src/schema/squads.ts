import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, snowflake, snowflakeArray, text, timestamptz, updatedAt } from './_columns';
import { squadProfileStatusEnum, squadRequestStatusEnum, squadStatusEnum } from './enums';
import { guilds } from './guilds';

import type { LockOverwrite } from './misc';
import type { SquadAnswers, SquadGameField } from '@goodbot/shared';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Toda tabela do módulo tem `guild_id`, inclusive as filhas que já chegam à
 * guild pelo squad (PRD §7.1): assim todo query filtra pela guild sem join, e
 * um uuid vindo de `custom_id` ou da URL nunca alcança o squad de outro
 * servidor.
 */
const guildRef = () =>
  snowflake('guild_id')
    .notNull()
    .references(() => guilds.id, { onDelete: 'cascade' });

/** Um jogo do módulo `squads`, com as perguntas do perfil definidas no painel. */
export const squadGames = pgTable(
  'squad_games',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: guildRef(),
    name: text('name').notNull(),
    /** Teto do squad inteiro; a faixa válida é a do `SquadGameInputSchema`. */
    groupSize: integer('group_size').notNull(),
    /** Quantos jogam juntos numa partida (`<= group_size`): a turma que o match propõe. */
    partySize: integer('party_size').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** Perguntas do perfil (no máximo 5, o que cabe num modal). */
    fields: jsonb('fields').$type<SquadGameField[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('squad_games_guild_name_uidx').on(t.guildId, t.name)],
);

/** Perfil de um jogador, um por jogo. */
export const squadProfiles = pgTable(
  'squad_profiles',
  {
    guildId: guildRef(),
    userId: snowflake('user_id').notNull(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => squadGames.id, { onDelete: 'cascade' }),
    /**
     * Grade semanal, bit `dia * 4 + faixa` (dia 0 = domingo). São 28 bits
     * (`SQUAD_AVAILABILITY_MAX`): `integer`, porque `smallint` não comporta.
     */
    availability: integer('availability').notNull().default(0),
    /** `{ chave do campo: resposta }`, conferido por `validateAnswers`. */
    answers: jsonb('answers').$type<SquadAnswers>().notNull().default({}),
    status: squadProfileStatusEnum('status').notNull().default('searching'),
    /** Última vez que o perfil entrou numa proposta. */
    lastMatchedAt: timestamptz('last_matched_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.guildId, t.userId, t.gameId] }),
    index('squad_profiles_guild_game_status_idx').on(t.guildId, t.gameId, t.status),
  ],
);

/** Um squad fixo: o mesmo grupo, que marca jogatina quando quer. */
export const squads = pgTable(
  'squads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: guildRef(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => squadGames.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /**
     * Canal de texto privado. `null` enquanto o canal está sendo criado ou
     * quando a criação falhou: a linha nasce antes do canal, na mesma
     * transação que reivindica a proposta, para dois aceites simultâneos não
     * criarem dois canais.
     */
    textChannelId: snowflake('text_channel_id'),
    /** Voice preferido do pool; `null` = o pool estava cheio. */
    voiceChannelId: snowflake('voice_channel_id'),
    /** O guia fixo (pinado) no canal do squad; `null` = ainda não publicado. */
    guideMessageId: snowflake('guide_message_id'),
    status: squadStatusEnum('status').notNull().default('open'),
    /** Último "vou" ou presença no voice; é o relógio da inatividade. */
    lastConfirmedAt: timestamptz('last_confirmed_at'),
    /** Quando o squad foi questionado por inatividade; `null` = não foi. */
    warnedAt: timestamptz('warned_at'),
    archivedAt: timestamptz('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('squads_guild_game_status_idx').on(t.guildId, t.gameId, t.status)],
);

export const squadMembers = pgTable(
  'squad_members',
  {
    guildId: guildRef(),
    squadId: uuid('squad_id')
      .notNull()
      .references(() => squads.id, { onDelete: 'cascade' }),
    userId: snowflake('user_id').notNull(),
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.squadId, t.userId] }),
    index('squad_members_guild_user_idx').on(t.guildId, t.userId),
  ],
);

/**
 * Uma proposta enviada a toda a turma compatível ao mesmo tempo. `user_ids` é
 * a turma: é o que o cooldown "mesma dupla não é reproposta" consulta.
 */
export const squadProposals = pgTable(
  'squad_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: guildRef(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => squadGames.id, { onDelete: 'cascade' }),
    userIds: snowflakeArray('user_ids'),
    /** Thread privada da proposta. */
    threadId: snowflake('thread_id').notNull(),
    /** Mensagem com os botões; `null` até ser enviada. */
    messageId: snowflake('message_id'),
    acceptedIds: snowflakeArray('accepted_ids'),
    declinedIds: snowflakeArray('declined_ids'),
    /**
     * Preenchido no primeiro aceite. `set null`, e não cascade: a proposta
     * continua valendo para o cooldown de dupla mesmo sem o squad.
     */
    squadId: uuid('squad_id').references(() => squads.id, { onDelete: 'set null' }),
    expiresAt: timestamptz('expires_at').notNull(),
    closedAt: timestamptz('closed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('squad_proposals_open_idx')
      .on(t.guildId, t.expiresAt)
      .where(sql`${t.closedAt} is null`),
    index('squad_proposals_guild_game_created_idx').on(t.guildId, t.gameId, t.createdAt),
    uniqueIndex('squad_proposals_thread_uidx').on(t.guildId, t.threadId),
  ],
);

/**
 * "Aberto" (`invited` ou `pending`) escrito pelos status que não são. O
 * `ADD VALUE 'invited'` da migration roda na mesma transação que cria os
 * índices, e o Postgres não deixa usar um valor de enum novo antes do commit.
 */
const openRequest = (status: AnyPgColumn) =>
  sql`${status} not in ('accepted', 'declined', 'expired')`;

/**
 * Entrada num squad existente, em duas fases. Na primeira o candidato recebe o
 * convite numa thread privada do canal de busca (`invited`); ao aceitar, o
 * pedido vai para o canal do squad e os membros votam (`pending`). Quem pede
 * pelo `/squad procurar` já nasce `pending`, e o convite de um membro entra sem
 * voto.
 */
export const squadJoinRequests = pgTable(
  'squad_join_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: guildRef(),
    squadId: uuid('squad_id')
      .notNull()
      .references(() => squads.id, { onDelete: 'cascade' }),
    userId: snowflake('user_id').notNull(),
    /** A votação no canal do squad; `null` enquanto é só convite ou até ser enviada. */
    messageId: snowflake('message_id'),
    status: squadRequestStatusEnum('status').notNull().default('pending'),
    /**
     * O membro que convidou (`/squad convidar` ou CONVIDAR no guia); `null` =
     * convite do matcher ou pedido do próprio candidato. Convite de membro
     * entra sem voto.
     */
    invitedBy: snowflake('invited_by'),
    /** Thread privada do convite no canal de busca; `null` = pedido sem convite. */
    threadId: snowflake('thread_id'),
    /** A mensagem com ENTRAR / PASSO na thread do convite. */
    inviteMessageId: snowflake('invite_message_id'),
    /**
     * A jogatina cuja chamada pública (CHAMAR GENTE) trouxe o pedido; `null` =
     * veio do matcher, de um membro ou do `/squad procurar`. `set null`: a
     * jogatina some com o squad, e o pedido já decidido continua valendo para
     * o cooldown.
     */
    sessionId: bigint('session_id', { mode: 'number' }).references(
      (): AnyPgColumn => squadSessions.id,
      { onDelete: 'set null' },
    ),
    /** Votos a favor dos membros. */
    acceptedIds: snowflakeArray('accepted_ids'),
    /** Votos contra. Um membro fica numa lista só: votar de novo troca de lado. */
    declinedIds: snowflakeArray('declined_ids'),
    decidedBy: snowflake('decided_by'),
    /**
     * `proposalTtlHours` a partir do convite; renova quando o candidato aceita
     * e a votação começa.
     */
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: createdAt(),
    decidedAt: timestamptz('decided_at'),
  },
  (t) => [
    // Um convite ou pedido aberto por pessoa e squad; depois de decidido, pode de novo.
    uniqueIndex('squad_join_requests_open_uidx')
      .on(t.squadId, t.userId)
      .where(openRequest(t.status)),
    index('squad_join_requests_open_expires_idx')
      .on(t.guildId, t.expiresAt)
      .where(openRequest(t.status)),
    index('squad_join_requests_guild_status_idx').on(t.guildId, t.status),
  ],
);

/**
 * Uma jogatina de um squad, marcada por um membro (`/bora` ou botão BORA).
 * Alimenta a mensagem com Vou / Não vou, o lembrete e a reserva do voice do
 * pool.
 *
 * O snapshot dos overwrites do voice mora aqui, e não em `channel_locks`:
 * aquela tabela é do `/lock` (um lock por canal), e um `/lock` num Hellpod
 * reservado colidiria com a reserva, e o `/unlock` restauraria o snapshot
 * errado.
 */
export const squadSessions = pgTable(
  'squad_sessions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: guildRef(),
    squadId: uuid('squad_id')
      .notNull()
      .references(() => squads.id, { onDelete: 'cascade' }),
    startsAt: timestamptz('starts_at').notNull(),
    /** `starts_at + sessionHours`: é quando o job libera o voice. */
    endsAt: timestamptz('ends_at').notNull(),
    /** Quem marcou; `null` = sessão do agendamento semanal antigo. */
    createdBy: snowflake('created_by'),
    remindedAt: timestamptz('reminded_at'),
    /** A mensagem da jogatina no canal do squad; os votos editam a contagem dela. */
    messageId: snowflake('message_id'),
    /** Quando o bot moveu os membros para o voice; trava contra mover duas vezes. */
    startedAt: timestamptz('started_at'),
    goingIds: snowflakeArray('going_ids'),
    notGoingIds: snowflakeArray('not_going_ids'),
    /** O voice reservado para esta sessão (do pool ou temporário); `null` = nada reservado. */
    voiceChannelId: snowflake('voice_channel_id'),
    /**
     * Overwrites que o voice tinha antes da reserva, para a liberação
     * restaurar exatamente o que existia. `null` = nada reservado, ou voice
     * temporário, que não tem o que restaurar.
     */
    voiceOverwrites: jsonb('voice_overwrites').$type<LockOverwrite[]>(),
    /**
     * O voice foi criado só para esta sessão, porque o pool estava cheio. A
     * liberação **apaga** o canal em vez de restaurar overwrites. É uma coluna,
     * e não "o voice não está no pool": tirar um voice do pool no painel com a
     * reserva viva faria a liberação apagar um canal do servidor.
     */
    voiceTemporary: boolean('voice_temporary').notNull().default(false),
    voiceReservedAt: timestamptz('voice_reserved_at'),
    voiceReleasedAt: timestamptz('voice_released_at'),
    /**
     * Primeiro sinal de que a jogatina rolou: alguém do squad no voice
     * reservado, ou o início com dois "vou" quando não há sala. É o que o
     * histórico conta.
     */
    playedAt: timestamptz('played_at'),
    cancelledAt: timestamptz('cancelled_at'),
    cancelledBy: snowflake('cancelled_by'),
    /**
     * Quando alguém apertou CHAMAR GENTE. É a trava de "uma chamada por
     * jogatina": gravado antes de postar no canal de busca.
     */
    calledAt: timestamptz('called_at'),
    /** Onde a chamada pública foi postada; o canal de busca pode mudar depois. */
    callChannelId: snowflake('call_channel_id'),
    /** A chamada pública no ar; volta a `null` quando ela é apagada no início da jogatina. */
    callMessageId: snowflake('call_message_id'),
    createdAt: createdAt(),
  },
  (t) => [
    // Dois `/bora` para o mesmo minuto viram uma jogatina só.
    uniqueIndex('squad_sessions_squad_starts_uidx').on(t.squadId, t.startsAt),
    index('squad_sessions_to_release_idx')
      .on(t.guildId, t.endsAt)
      .where(sql`${t.voiceReservedAt} is not null and ${t.voiceReleasedAt} is null`),
    index('squad_sessions_guild_starts_idx').on(t.guildId, t.startsAt),
  ],
);

/**
 * Quem do squad esteve no voice reservado de uma jogatina, e de quando a
 * quando. Uma linha por entrada: sair e voltar abre outra. É a presença de
 * verdade que o histórico conta, porque "vou" não prova que a pessoa foi.
 *
 * Gravada pelo evento de voz e pela varredura do bot (`sweepPresence`), que
 * cobre o que o evento não vê: quem já estava no voice quando a reserva saiu
 * e quem entrou ou saiu com o bot fora do ar. Linha sem `left_at` é quem ainda
 * está; a de quem saiu com o bot fora do ar fecha na varredura seguinte, na
 * hora dela, e por isso superestima o tempo dessa pessoa.
 */
export const squadSessionAttendance = pgTable(
  'squad_session_attendance',
  {
    guildId: guildRef(),
    sessionId: bigint('session_id', { mode: 'number' })
      .notNull()
      .references(() => squadSessions.id, { onDelete: 'cascade' }),
    userId: snowflake('user_id').notNull(),
    joinedAt: timestamptz('joined_at').notNull(),
    leftAt: timestamptz('left_at'),
    /**
     * Presença de convidado avulso (`squad_session_guests`): conta no tempo e
     * nas formações, mas não marca `played_at`, não é sinal de vida do squad
     * e fica fora do histórico. Decidido na entrada: quem entra no squad
     * depois passa a contar como membro dali em diante.
     */
    asGuest: boolean('as_guest').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.userId, t.joinedAt] }),
    index('squad_session_attendance_guild_user_idx').on(t.guildId, t.userId),
  ],
);

/**
 * Convidado avulso de uma jogatina (TRAZER CONVIDADO): joga só aquela, sem
 * entrar no squad. Ganha o voice reservado como um membro, e a liberação o
 * devolve junto. O aviso vai numa thread privada do canal de busca com quem
 * convidou, porque o convidado não vê o canal do squad.
 */
export const squadSessionGuests = pgTable(
  'squad_session_guests',
  {
    guildId: guildRef(),
    sessionId: bigint('session_id', { mode: 'number' })
      .notNull()
      .references(() => squadSessions.id, { onDelete: 'cascade' }),
    userId: snowflake('user_id').notNull(),
    /** O membro do squad que trouxe. */
    invitedBy: snowflake('invited_by').notNull(),
    /** A thread privada do aviso; `null` enquanto ela nasce. */
    threadId: snowflake('thread_id'),
    invitedAt: timestamptz('invited_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.userId] }),
    index('squad_session_guests_guild_user_idx').on(t.guildId, t.userId),
  ],
);
