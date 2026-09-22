import {
  joinRequestKey,
  pairKey,
  SQUAD_OPEN_REQUEST_STATUSES,
  SQUAD_PRESENCE_LEAD_MS,
  type SquadAnswers,
  type SquadGameField,
  type SquadOpenRequestStatus,
  type SquadProfileStatus,
  type SquadStatus,
} from '@goodbot/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import { guilds } from '../schema/guilds';
import {
  squadGames,
  squadJoinRequests,
  squadMembers,
  squadProfiles,
  squadProposals,
  squads,
  squadSessionAttendance,
  squadSessions,
} from '../schema/squads';

import type { DbExecutor } from '../client';
import type { LockOverwrite } from '../schema/misc';
import type {
  Squad,
  SquadGame,
  SquadJoinRequest,
  SquadMember,
  SquadProfile,
  SquadProposal,
  SquadSession,
} from '../types';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/** A guild pode ainda não ter linha própria quando o painel cria o primeiro jogo. */
async function ensureGuild(db: DbExecutor, guildId: string): Promise<void> {
  await db
    .insert(guilds)
    .values({ id: guildId, name: '', ownerId: '' })
    .onConflictDoNothing({ target: guilds.id });
}

// Listas de IDs (`text[]`) mudam só em SQL, numa `UPDATE` só: ler, mexer no JS
// e gravar perderia o clique de quem apertou o botão no mesmo instante. Quem
// acrescenta põe o guard `lacksId` no `where`, e é ele que impede a repetição.

const hasId = (column: AnyPgColumn, id: string): SQL => sql`${id}::text = any(${column})`;
const lacksId = (column: AnyPgColumn, id: string): SQL => sql`not (${id}::text = any(${column}))`;
const appendId = (column: AnyPgColumn, id: string): SQL =>
  sql`array_append(${column}, ${id}::text)`;
const removeId = (column: AnyPgColumn, id: string): SQL =>
  sql`array_remove(${column}, ${id}::text)`;

// ── jogos ───────────────────────────────────────────────────────────────────

export interface CreateSquadGameInput {
  guildId: string;
  name: string;
  groupSize: number;
  partySize: number;
  enabled?: boolean;
  fields?: SquadGameField[];
}

export async function listSquadGames(db: DbExecutor, guildId: string): Promise<SquadGame[]> {
  return db
    .select()
    .from(squadGames)
    .where(eq(squadGames.guildId, guildId))
    .orderBy(asc(squadGames.name));
}

export async function getSquadGame(
  db: DbExecutor,
  guildId: string,
  gameId: string,
): Promise<SquadGame | null> {
  const [row] = await db
    .select()
    .from(squadGames)
    .where(and(eq(squadGames.guildId, guildId), eq(squadGames.id, gameId)))
    .limit(1);
  return row ?? null;
}

/** `null` quando já existe um jogo com o mesmo nome na guild. */
export async function createSquadGame(
  db: DbExecutor,
  input: CreateSquadGameInput,
): Promise<SquadGame | null> {
  await ensureGuild(db, input.guildId);
  const [row] = await db
    .insert(squadGames)
    .values(input)
    .onConflictDoNothing({ target: [squadGames.guildId, squadGames.name] })
    .returning();
  return row ?? null;
}

export type UpdateSquadGameInput = Partial<Omit<CreateSquadGameInput, 'guildId'>>;

/** `null` quando o jogo não existe nesta guild. Nome repetido estoura o índice único. */
export async function updateSquadGame(
  db: DbExecutor,
  guildId: string,
  gameId: string,
  input: UpdateSquadGameInput,
): Promise<SquadGame | null> {
  const [row] = await db
    .update(squadGames)
    .set({ ...input, updatedAt: sql`now()` })
    .where(and(eq(squadGames.guildId, guildId), eq(squadGames.id, gameId)))
    .returning();
  return row ?? null;
}

/**
 * Apaga o jogo e, em cascata, perfis, squads, propostas, pedidos e sessões
 * dele. Os canais no Discord não somem junto: quem chama cuida deles antes.
 */
export async function deleteSquadGame(
  db: DbExecutor,
  guildId: string,
  gameId: string,
): Promise<SquadGame | null> {
  const [row] = await db
    .delete(squadGames)
    .where(and(eq(squadGames.guildId, guildId), eq(squadGames.id, gameId)))
    .returning();
  return row ?? null;
}

// ── perfis ──────────────────────────────────────────────────────────────────

export interface UpsertSquadProfileInput {
  guildId: string;
  userId: string;
  gameId: string;
  availability: number;
  answers: SquadAnswers;
  /** Ausente mantém o status gravado (ou `searching`, num perfil novo). */
  status?: SquadProfileStatus;
}

export async function upsertSquadProfile(
  db: DbExecutor,
  input: UpsertSquadProfileInput,
): Promise<SquadProfile> {
  const [row] = await db
    .insert(squadProfiles)
    .values(input)
    .onConflictDoUpdate({
      target: [squadProfiles.guildId, squadProfiles.userId, squadProfiles.gameId],
      set: {
        availability: input.availability,
        answers: input.answers,
        ...(input.status ? { status: input.status } : {}),
        updatedAt: sql`now()`,
      },
    })
    .returning();
  if (!row) throw new Error('UPSERT em squad_profiles não retornou linha');
  return row;
}

/** Cria o perfil só quando não existe; `null` = já existia e nada mudou. */
export async function createSquadProfileIfMissing(
  db: DbExecutor,
  input: UpsertSquadProfileInput,
): Promise<SquadProfile | null> {
  const [row] = await db
    .insert(squadProfiles)
    .values(input)
    .onConflictDoNothing({
      target: [squadProfiles.guildId, squadProfiles.userId, squadProfiles.gameId],
    })
    .returning();
  return row ?? null;
}

export async function getSquadProfile(
  db: DbExecutor,
  guildId: string,
  userId: string,
  gameId: string,
): Promise<SquadProfile | null> {
  const [row] = await db
    .select()
    .from(squadProfiles)
    .where(
      and(
        eq(squadProfiles.guildId, guildId),
        eq(squadProfiles.userId, userId),
        eq(squadProfiles.gameId, gameId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listSquadProfilesByUser(
  db: DbExecutor,
  guildId: string,
  userId: string,
): Promise<SquadProfile[]> {
  return db
    .select()
    .from(squadProfiles)
    .where(and(eq(squadProfiles.guildId, guildId), eq(squadProfiles.userId, userId)))
    .orderBy(asc(squadProfiles.createdAt));
}

/** Perfis `searching` de um jogo, em ordem de `user_id`: a entrada do matcher. */
export async function listSearchingProfiles(
  db: DbExecutor,
  guildId: string,
  gameId: string,
): Promise<SquadProfile[]> {
  return db
    .select()
    .from(squadProfiles)
    .where(
      and(
        eq(squadProfiles.guildId, guildId),
        eq(squadProfiles.gameId, gameId),
        eq(squadProfiles.status, 'searching'),
      ),
    )
    .orderBy(asc(squadProfiles.userId));
}

/**
 * Perfis de um jogo em qualquer status, em ordem de `user_id`: a lista de
 * jogadores do painel e a revisão do match manual. Com `userIds`, só esses.
 */
export async function listSquadProfilesByGame(
  db: DbExecutor,
  guildId: string,
  gameId: string,
  options: { userIds?: readonly string[] } = {},
): Promise<SquadProfile[]> {
  const filters: SQL[] = [eq(squadProfiles.guildId, guildId), eq(squadProfiles.gameId, gameId)];
  if (options.userIds) {
    // `in ()` vazio não é SQL válido, e a resposta já se sabe.
    if (options.userIds.length === 0) return [];
    filters.push(inArray(squadProfiles.userId, [...options.userIds]));
  }
  return db
    .select()
    .from(squadProfiles)
    .where(and(...filters))
    .orderBy(asc(squadProfiles.userId));
}

/** Apaga o perfil. `null` quando não existia (ou outro clique já apagou). */
export async function deleteSquadProfile(
  db: DbExecutor,
  guildId: string,
  userId: string,
  gameId: string,
): Promise<SquadProfile | null> {
  const [row] = await db
    .delete(squadProfiles)
    .where(
      and(
        eq(squadProfiles.guildId, guildId),
        eq(squadProfiles.userId, userId),
        eq(squadProfiles.gameId, gameId),
      ),
    )
    .returning();
  return row ?? null;
}

/** `gameId → perfis searching`, para os contadores do painel. Jogo sem ninguém fica de fora. */
export async function countSearchingProfilesByGame(
  db: DbExecutor,
  guildId: string,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ gameId: squadProfiles.gameId, count: count() })
    .from(squadProfiles)
    .where(and(eq(squadProfiles.guildId, guildId), eq(squadProfiles.status, 'searching')))
    .groupBy(squadProfiles.gameId);
  return Object.fromEntries(rows.map((row) => [row.gameId, row.count]));
}

export async function setSquadProfileStatus(
  db: DbExecutor,
  guildId: string,
  userId: string,
  gameId: string,
  status: SquadProfileStatus,
): Promise<SquadProfile | null> {
  const [row] = await db
    .update(squadProfiles)
    .set({ status, updatedAt: sql`now()` })
    .where(
      and(
        eq(squadProfiles.guildId, guildId),
        eq(squadProfiles.userId, userId),
        eq(squadProfiles.gameId, gameId),
      ),
    )
    .returning();
  return row ?? null;
}

/** Marca quem entrou numa proposta agora. Devolve quantos perfis mudaram. */
export async function markProfilesMatched(
  db: DbExecutor,
  guildId: string,
  gameId: string,
  userIds: readonly string[],
  at: Date,
): Promise<number> {
  if (userIds.length === 0) return 0;
  const rows = await db
    .update(squadProfiles)
    .set({ lastMatchedAt: at })
    .where(
      and(
        eq(squadProfiles.guildId, guildId),
        eq(squadProfiles.gameId, gameId),
        inArray(squadProfiles.userId, [...userIds]),
      ),
    )
    .returning({ userId: squadProfiles.userId });
  return rows.length;
}

// ── squads ──────────────────────────────────────────────────────────────────

export interface CreateSquadInput {
  guildId: string;
  gameId: string;
  name: string;
  /** Voice preferido do pool; `null` = pool cheio. */
  voiceChannelId?: string | null;
  status?: Exclude<SquadStatus, 'archived'>;
}

/**
 * A linha nasce sem canal de texto: ele é criado no Discord depois, e só
 * então gravado com `setSquadTextChannel`.
 */
export async function createSquad(db: DbExecutor, input: CreateSquadInput): Promise<Squad> {
  const [row] = await db.insert(squads).values(input).returning();
  if (!row) throw new Error('INSERT em squads não retornou linha');
  return row;
}

export async function getSquad(
  db: DbExecutor,
  guildId: string,
  squadId: string,
): Promise<Squad | null> {
  const [row] = await db
    .select()
    .from(squads)
    .where(and(eq(squads.guildId, guildId), eq(squads.id, squadId)))
    .limit(1);
  return row ?? null;
}

export interface ListSquadsOptions {
  gameId?: string;
  /** Lista vazia é o mesmo que não filtrar. */
  statuses?: readonly SquadStatus[];
}

export async function listSquads(
  db: DbExecutor,
  guildId: string,
  options: ListSquadsOptions = {},
): Promise<Squad[]> {
  const filters: SQL[] = [eq(squads.guildId, guildId)];
  if (options.gameId) filters.push(eq(squads.gameId, options.gameId));
  if (options.statuses?.length) filters.push(inArray(squads.status, [...options.statuses]));
  return db
    .select()
    .from(squads)
    .where(and(...filters))
    .orderBy(asc(squads.createdAt));
}

export async function setSquadTextChannel(
  db: DbExecutor,
  guildId: string,
  squadId: string,
  textChannelId: string | null,
): Promise<Squad | null> {
  const [row] = await db
    .update(squads)
    .set({ textChannelId, updatedAt: sql`now()` })
    .where(and(eq(squads.guildId, guildId), eq(squads.id, squadId)))
    .returning();
  return row ?? null;
}

export async function setSquadVoiceChannel(
  db: DbExecutor,
  guildId: string,
  squadId: string,
  voiceChannelId: string | null,
): Promise<Squad | null> {
  const [row] = await db
    .update(squads)
    .set({ voiceChannelId, updatedAt: sql`now()` })
    .where(and(eq(squads.guildId, guildId), eq(squads.id, squadId)))
    .returning();
  return row ?? null;
}

/**
 * Alterna entre `open` e `full`. `null` quando o squad sumiu ou já foi
 * arquivado: alguém saindo depois do arquivamento não reabre a vaga.
 */
export async function setSquadStatus(
  db: DbExecutor,
  guildId: string,
  squadId: string,
  status: Exclude<SquadStatus, 'archived'>,
): Promise<Squad | null> {
  const [row] = await db
    .update(squads)
    .set({ status, updatedAt: sql`now()` })
    .where(and(eq(squads.guildId, guildId), eq(squads.id, squadId), ne(squads.status, 'archived')))
    .returning();
  return row ?? null;
}

/**
 * Põe `open`/`full` dos squads vivos de um jogo de acordo com um tamanho de
 * grupo novo. O status só muda quando alguém entra ou sai, então sem isto subir
 * o grupo de 4 para 8 deixaria fora da busca, para sempre, todo squad que já
 * estava cheio; e descer deixaria vaga aberta num squad que já passou do teto.
 * Duas `UPDATE`s condicionais: repetir não muda nada. Devolve os que mudaram.
 */
export async function syncSquadStatusesToGroupSize(
  db: DbExecutor,
  guildId: string,
  gameId: string,
  groupSize: number,
): Promise<Array<Pick<Squad, 'id' | 'status'>>> {
  const atCapacity = db
    .select({ squadId: squadMembers.squadId })
    .from(squadMembers)
    .where(eq(squadMembers.guildId, guildId))
    .groupBy(squadMembers.squadId)
    .having(sql`count(*) >= ${groupSize}`);
  const ofGame = and(eq(squads.guildId, guildId), eq(squads.gameId, gameId));
  const changed = { id: squads.id, status: squads.status };

  const reopened = await db
    .update(squads)
    .set({ status: 'open', updatedAt: sql`now()` })
    .where(and(ofGame, eq(squads.status, 'full'), notInArray(squads.id, atCapacity)))
    .returning(changed);
  const filled = await db
    .update(squads)
    .set({ status: 'full', updatedAt: sql`now()` })
    .where(and(ofGame, eq(squads.status, 'open'), inArray(squads.id, atCapacity)))
    .returning(changed);
  return [...reopened, ...filled];
}

export async function renameSquad(
  db: DbExecutor,
  guildId: string,
  squadId: string,
  name: string,
): Promise<Squad | null> {
  const [row] = await db
    .update(squads)
    .set({ name, updatedAt: sql`now()` })
    .where(and(eq(squads.guildId, guildId), eq(squads.id, squadId)))
    .returning();
  return row ?? null;
}

/** `null` quando já estava arquivado: job e painel ao mesmo tempo arquivam uma vez. */
export async function archiveSquad(
  db: DbExecutor,
  guildId: string,
  squadId: string,
  at: Date,
): Promise<Squad | null> {
  const [row] = await db
    .update(squads)
    .set({ status: 'archived', archivedAt: at, updatedAt: sql`now()` })
    .where(and(eq(squads.guildId, guildId), eq(squads.id, squadId), ne(squads.status, 'archived')))
    .returning();
  return row ?? null;
}

/**
 * Grava o guia fixo do squad só se o valor gravado ainda é `expected`. Dois
 * refresh ao mesmo tempo, com o guia sumido, publicariam dois guias: quem
 * perde recebe `null` e apaga a mensagem que acabou de mandar.
 */
export async function setSquadGuideMessage(
  db: DbExecutor,
  guildId: string,
  squadId: string,
  messageId: string | null,
  expected: string | null,
): Promise<Squad | null> {
  const [row] = await db
    .update(squads)
    .set({ guideMessageId: messageId, updatedAt: sql`now()` })
    .where(
      and(
        eq(squads.guildId, guildId),
        eq(squads.id, squadId),
        expected === null ? isNull(squads.guideMessageId) : eq(squads.guideMessageId, expected),
      ),
    )
    .returning();
  return row ?? null;
}

/** Uma jogatina marcada, um "vou" ou alguém no voice: o squad está vivo. */
export async function touchSquadConfirmed(
  db: DbExecutor,
  guildId: string,
  squadId: string,
  at: Date,
): Promise<Squad | null> {
  const [row] = await db
    .update(squads)
    .set({ lastConfirmedAt: at, updatedAt: sql`now()` })
    .where(and(eq(squads.guildId, guildId), eq(squads.id, squadId)))
    .returning();
  return row ?? null;
}

/** `null` quando já foi questionado ou está arquivado: o job não pergunta duas vezes. */
export async function markSquadWarned(
  db: DbExecutor,
  guildId: string,
  squadId: string,
  at: Date,
): Promise<Squad | null> {
  const [row] = await db
    .update(squads)
    .set({ warnedAt: at, updatedAt: sql`now()` })
    .where(
      and(
        eq(squads.guildId, guildId),
        eq(squads.id, squadId),
        isNull(squads.warnedAt),
        ne(squads.status, 'archived'),
      ),
    )
    .returning();
  return row ?? null;
}

export async function clearSquadWarned(
  db: DbExecutor,
  guildId: string,
  squadId: string,
): Promise<Squad | null> {
  const [row] = await db
    .update(squads)
    .set({ warnedAt: null, updatedAt: sql`now()` })
    .where(and(eq(squads.guildId, guildId), eq(squads.id, squadId)))
    .returning();
  return row ?? null;
}

/** Squads `open` de um jogo: as vagas que o matcher ainda pode oferecer. */
export async function listOpenSquadsByGame(
  db: DbExecutor,
  guildId: string,
  gameId: string,
): Promise<Squad[]> {
  return db
    .select()
    .from(squads)
    .where(and(eq(squads.guildId, guildId), eq(squads.gameId, gameId), eq(squads.status, 'open')))
    .orderBy(asc(squads.createdAt));
}

/** Squads não arquivados com canal de texto: o contador do painel. */
export async function countSquadChannels(db: DbExecutor, guildId: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(squads)
    .where(
      and(
        eq(squads.guildId, guildId),
        ne(squads.status, 'archived'),
        isNotNull(squads.textChannelId),
      ),
    );
  return row?.count ?? 0;
}

/**
 * Squads não arquivados sem confirmação desde `since`. Sem nenhuma
 * confirmação, conta a criação: squad novo tem o prazo inteiro antes de ser
 * questionado. `last_confirmed_at` é a fonte única, porque tanto o "vou"
 * quanto a presença no voice o atualizam.
 */
export async function listInactiveSquads(
  db: DbExecutor,
  guildId: string,
  since: Date,
): Promise<Squad[]> {
  return db
    .select()
    .from(squads)
    .where(
      and(
        eq(squads.guildId, guildId),
        ne(squads.status, 'archived'),
        // `coalesce(last_confirmed_at, created_at) < since`, pelos operadores
        // para o `Date` passar pelo mapeamento da coluna (ver `registry.ts`).
        or(
          lt(squads.lastConfirmedAt, since),
          and(isNull(squads.lastConfirmedAt), lt(squads.createdAt, since)),
        ),
      ),
    )
    .orderBy(asc(squads.createdAt));
}

// ── membros ─────────────────────────────────────────────────────────────────

export interface AddSquadMemberInput {
  guildId: string;
  squadId: string;
  userId: string;
}

/** `null` quando a pessoa já era membro. */
export async function addSquadMember(
  db: DbExecutor,
  input: AddSquadMemberInput,
): Promise<SquadMember | null> {
  const [row] = await db
    .insert(squadMembers)
    .values(input)
    .onConflictDoNothing({ target: [squadMembers.squadId, squadMembers.userId] })
    .returning();
  return row ?? null;
}

export async function removeSquadMember(
  db: DbExecutor,
  guildId: string,
  squadId: string,
  userId: string,
): Promise<SquadMember | null> {
  const [row] = await db
    .delete(squadMembers)
    .where(
      and(
        eq(squadMembers.guildId, guildId),
        eq(squadMembers.squadId, squadId),
        eq(squadMembers.userId, userId),
      ),
    )
    .returning();
  return row ?? null;
}

export async function listSquadMembers(
  db: DbExecutor,
  guildId: string,
  squadId: string,
): Promise<SquadMember[]> {
  return db
    .select()
    .from(squadMembers)
    .where(and(eq(squadMembers.guildId, guildId), eq(squadMembers.squadId, squadId)))
    .orderBy(asc(squadMembers.joinedAt));
}

/** Membros de vários squads numa consulta só: a lista do painel não faz uma por squad. */
export async function listMembersOfSquads(
  db: DbExecutor,
  guildId: string,
  squadIds: readonly string[],
): Promise<SquadMember[]> {
  if (squadIds.length === 0) return [];
  return db
    .select()
    .from(squadMembers)
    .where(and(eq(squadMembers.guildId, guildId), inArray(squadMembers.squadId, [...squadIds])))
    .orderBy(asc(squadMembers.joinedAt));
}

/** Em quantos squads não arquivados a pessoa está: o teto é `maxSquadsPerUser`. */
export async function countSquadsForUser(
  db: DbExecutor,
  guildId: string,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(squadMembers)
    .innerJoin(squads, eq(squads.id, squadMembers.squadId))
    .where(
      and(
        eq(squadMembers.guildId, guildId),
        eq(squadMembers.userId, userId),
        eq(squads.guildId, guildId),
        ne(squads.status, 'archived'),
      ),
    );
  return row?.count ?? 0;
}

/** Squads da pessoa, na ordem em que ela entrou. Arquivados só com `includeArchived`. */
export async function listSquadsForUser(
  db: DbExecutor,
  guildId: string,
  userId: string,
  options: { includeArchived?: boolean } = {},
): Promise<Squad[]> {
  const filters: SQL[] = [
    eq(squadMembers.guildId, guildId),
    eq(squadMembers.userId, userId),
    eq(squads.guildId, guildId),
  ];
  if (!options.includeArchived) filters.push(ne(squads.status, 'archived'));
  return db
    .select(getTableColumns(squads))
    .from(squadMembers)
    .innerJoin(squads, eq(squads.id, squadMembers.squadId))
    .where(and(...filters))
    .orderBy(asc(squadMembers.joinedAt));
}

// ── propostas ───────────────────────────────────────────────────────────────

export interface CreateSquadProposalInput {
  guildId: string;
  gameId: string;
  /** A turma inteira; é o que o cooldown de dupla consulta. */
  userIds: string[];
  threadId: string;
  expiresAt: Date;
}

export async function createSquadProposal(
  db: DbExecutor,
  input: CreateSquadProposalInput,
): Promise<SquadProposal> {
  const [row] = await db.insert(squadProposals).values(input).returning();
  if (!row) throw new Error('INSERT em squad_proposals não retornou linha');
  return row;
}

/** Grava a mensagem com os botões, enviada depois da linha (o `custom_id` leva o id). */
export async function setSquadProposalMessage(
  db: DbExecutor,
  guildId: string,
  proposalId: string,
  messageId: string,
): Promise<SquadProposal | null> {
  const [row] = await db
    .update(squadProposals)
    .set({ messageId })
    .where(and(eq(squadProposals.guildId, guildId), eq(squadProposals.id, proposalId)))
    .returning();
  return row ?? null;
}

export async function getSquadProposal(
  db: DbExecutor,
  guildId: string,
  proposalId: string,
): Promise<SquadProposal | null> {
  const [row] = await db
    .select()
    .from(squadProposals)
    .where(and(eq(squadProposals.guildId, guildId), eq(squadProposals.id, proposalId)))
    .limit(1);
  return row ?? null;
}

export async function getSquadProposalByThread(
  db: DbExecutor,
  guildId: string,
  threadId: string,
): Promise<SquadProposal | null> {
  const [row] = await db
    .select()
    .from(squadProposals)
    .where(and(eq(squadProposals.guildId, guildId), eq(squadProposals.threadId, threadId)))
    .limit(1);
  return row ?? null;
}

/**
 * Amarra a proposta ao squad do primeiro aceite. `null` quando outra pessoa
 * chegou antes (ou a proposta fechou).
 *
 * Dois "Aceito" no mesmo instante não podem criar dois squads. O bot chama
 * isto numa transação, logo depois de inserir a linha do squad: a `UPDATE`
 * trava a linha da proposta, a segunda transação espera a primeira terminar
 * e reavalia `squad_id is null`, que já é falso. Com `null`, quem chamou faz
 * rollback (o squad inserido some junto) e entra no squad vencedor.
 */
export async function claimProposalSquad(
  db: DbExecutor,
  guildId: string,
  proposalId: string,
  squadId: string,
): Promise<SquadProposal | null> {
  const [row] = await db
    .update(squadProposals)
    .set({ squadId })
    .where(
      and(
        eq(squadProposals.guildId, guildId),
        eq(squadProposals.id, proposalId),
        isNull(squadProposals.squadId),
        isNull(squadProposals.closedAt),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Põe a pessoa nos aceites e a tira das recusas, numa `UPDATE` só. `null`
 * quando nada mudou: proposta fechada ou de outra guild, pessoa fora da turma
 * ou que já tinha aceitado. Clique duplo, portanto, não ocupa duas vagas.
 */
export async function acceptSquadProposal(
  db: DbExecutor,
  guildId: string,
  proposalId: string,
  userId: string,
): Promise<SquadProposal | null> {
  const [row] = await db
    .update(squadProposals)
    .set({
      acceptedIds: appendId(squadProposals.acceptedIds, userId),
      declinedIds: removeId(squadProposals.declinedIds, userId),
    })
    .where(
      and(
        eq(squadProposals.guildId, guildId),
        eq(squadProposals.id, proposalId),
        isNull(squadProposals.closedAt),
        hasId(squadProposals.userIds, userId),
        lacksId(squadProposals.acceptedIds, userId),
      ),
    )
    .returning();
  return row ?? null;
}

/** O espelho de `acceptSquadProposal`: `null` quando nada mudou. */
export async function declineSquadProposal(
  db: DbExecutor,
  guildId: string,
  proposalId: string,
  userId: string,
): Promise<SquadProposal | null> {
  const [row] = await db
    .update(squadProposals)
    .set({
      declinedIds: appendId(squadProposals.declinedIds, userId),
      acceptedIds: removeId(squadProposals.acceptedIds, userId),
    })
    .where(
      and(
        eq(squadProposals.guildId, guildId),
        eq(squadProposals.id, proposalId),
        isNull(squadProposals.closedAt),
        hasId(squadProposals.userIds, userId),
        lacksId(squadProposals.declinedIds, userId),
      ),
    )
    .returning();
  return row ?? null;
}

/** `null` quando já estava fechada. */
export async function closeSquadProposal(
  db: DbExecutor,
  guildId: string,
  proposalId: string,
  at: Date,
): Promise<SquadProposal | null> {
  const [row] = await db
    .update(squadProposals)
    .set({ closedAt: at })
    .where(
      and(
        eq(squadProposals.guildId, guildId),
        eq(squadProposals.id, proposalId),
        isNull(squadProposals.closedAt),
      ),
    )
    .returning();
  return row ?? null;
}

export async function listOpenSquadProposals(
  db: DbExecutor,
  guildId: string,
): Promise<SquadProposal[]> {
  return db
    .select()
    .from(squadProposals)
    .where(and(eq(squadProposals.guildId, guildId), isNull(squadProposals.closedAt)))
    .orderBy(asc(squadProposals.createdAt));
}

/** Abertas com o prazo vencido em `now`; com ou sem squad, quem decide é o job. */
export async function listExpiredSquadProposals(
  db: DbExecutor,
  guildId: string,
  now: Date,
): Promise<SquadProposal[]> {
  return db
    .select()
    .from(squadProposals)
    .where(
      and(
        eq(squadProposals.guildId, guildId),
        isNull(squadProposals.closedAt),
        lte(squadProposals.expiresAt, now),
      ),
    )
    .orderBy(asc(squadProposals.expiresAt));
}

/**
 * `pairKey` de toda dupla de toda proposta do jogo criada em `since` ou
 * depois, sem repetição: é o cooldown "mesma dupla não é reproposta". Quem
 * chama calcula `since`, e o relógio fica fora do repositório.
 */
export async function listRecentProposalPairs(
  db: DbExecutor,
  guildId: string,
  gameId: string,
  since: Date,
): Promise<string[]> {
  const rows = await db
    .select({ userIds: squadProposals.userIds })
    .from(squadProposals)
    .where(
      and(
        eq(squadProposals.guildId, guildId),
        eq(squadProposals.gameId, gameId),
        gte(squadProposals.createdAt, since),
      ),
    );
  const keys = new Set<string>();
  for (const { userIds } of rows) {
    userIds.forEach((a, index) => {
      for (const b of userIds.slice(index + 1)) {
        if (a !== b) keys.add(pairKey(a, b));
      }
    });
  }
  return [...keys];
}

// ── pedidos de entrada ──────────────────────────────────────────────────────

const isOpenRequest = (): SQL =>
  inArray(squadJoinRequests.status, [...SQUAD_OPEN_REQUEST_STATUSES]);

export interface CreateSquadJoinRequestInput {
  guildId: string;
  squadId: string;
  userId: string;
  /** `invited` = convite (fase 1); `pending` = já na votação do squad. */
  status: SquadOpenRequestStatus;
  /** O membro que convidou; ausente = matcher ou o próprio candidato. */
  invitedBy?: string | null;
  /** A jogatina cuja chamada pública trouxe o pedido. */
  sessionId?: number | null;
  expiresAt: Date;
}

/** `null` quando a pessoa já tem convite ou pedido aberto para este squad. */
export async function createSquadJoinRequest(
  db: DbExecutor,
  input: CreateSquadJoinRequestInput,
): Promise<SquadJoinRequest | null> {
  const [row] = await db
    .insert(squadJoinRequests)
    .values(input)
    .onConflictDoNothing({
      target: [squadJoinRequests.squadId, squadJoinRequests.userId],
      // O mesmo predicado do índice parcial (ver `schema/squads.ts`).
      where: sql`status not in ('accepted', 'declined', 'expired')`,
    })
    .returning();
  return row ?? null;
}

/** Grava a votação no canal do squad, enviada depois da linha (o `custom_id` leva o id). */
export async function setSquadJoinRequestMessage(
  db: DbExecutor,
  guildId: string,
  requestId: string,
  messageId: string,
): Promise<SquadJoinRequest | null> {
  const [row] = await db
    .update(squadJoinRequests)
    .set({ messageId })
    .where(and(eq(squadJoinRequests.guildId, guildId), eq(squadJoinRequests.id, requestId)))
    .returning();
  return row ?? null;
}

/** Grava a thread e a mensagem do convite, criadas depois da linha. */
export async function setSquadJoinRequestInvite(
  db: DbExecutor,
  guildId: string,
  requestId: string,
  input: { threadId: string; inviteMessageId: string },
): Promise<SquadJoinRequest | null> {
  const [row] = await db
    .update(squadJoinRequests)
    .set(input)
    .where(and(eq(squadJoinRequests.guildId, guildId), eq(squadJoinRequests.id, requestId)))
    .returning();
  return row ?? null;
}

export async function getSquadJoinRequest(
  db: DbExecutor,
  guildId: string,
  requestId: string,
): Promise<SquadJoinRequest | null> {
  const [row] = await db
    .select()
    .from(squadJoinRequests)
    .where(and(eq(squadJoinRequests.guildId, guildId), eq(squadJoinRequests.id, requestId)))
    .limit(1);
  return row ?? null;
}

/**
 * O candidato aceitou o convite: `invited` vira `pending` e o prazo recomeça
 * para a votação. `null` quando o convite já não estava aberto (dois cliques,
 * ou o job expirou no mesmo instante).
 */
export async function startSquadJoinVote(
  db: DbExecutor,
  guildId: string,
  requestId: string,
  expiresAt: Date,
): Promise<SquadJoinRequest | null> {
  const [row] = await db
    .update(squadJoinRequests)
    .set({ status: 'pending', expiresAt })
    .where(
      and(
        eq(squadJoinRequests.guildId, guildId),
        eq(squadJoinRequests.id, requestId),
        eq(squadJoinRequests.status, 'invited'),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * O voto de um membro, numa `UPDATE` só: entra na lista escolhida e sai da
 * outra, então votar de novo troca de lado. `null` quando nada mudou: a
 * votação acabou ou o membro já tinha votado assim.
 */
export async function voteSquadJoinRequest(
  db: DbExecutor,
  guildId: string,
  requestId: string,
  userId: string,
  inFavor: boolean,
): Promise<SquadJoinRequest | null> {
  const [target, other] = inFavor
    ? [squadJoinRequests.acceptedIds, squadJoinRequests.declinedIds]
    : [squadJoinRequests.declinedIds, squadJoinRequests.acceptedIds];
  const [row] = await db
    .update(squadJoinRequests)
    .set(
      inFavor
        ? { acceptedIds: appendId(target, userId), declinedIds: removeId(other, userId) }
        : { declinedIds: appendId(target, userId), acceptedIds: removeId(other, userId) },
    )
    .where(
      and(
        eq(squadJoinRequests.guildId, guildId),
        eq(squadJoinRequests.id, requestId),
        eq(squadJoinRequests.status, 'pending'),
        lacksId(target, userId),
      ),
    )
    .returning();
  return row ?? null;
}

export interface DecideSquadJoinRequestInput {
  /** `expired` = ninguém decidiu a tempo, ou o bot encerrou (squad cheio ou arquivado). */
  status: 'accepted' | 'declined' | 'expired';
  /** Quem decidiu: o candidato que passou, o membro que fechou a votação; `null` = o bot. */
  decidedBy: string | null;
  at: Date;
  /** De que status pode sair; o padrão é qualquer um aberto. */
  from?: readonly SquadOpenRequestStatus[];
}

/**
 * Fecha o pedido enquanto ele ainda está aberto. `null` quando outra decisão
 * chegou antes: dois votos que fecham a votação não põem a pessoa duas vezes.
 */
export async function decideSquadJoinRequest(
  db: DbExecutor,
  guildId: string,
  requestId: string,
  input: DecideSquadJoinRequestInput,
): Promise<SquadJoinRequest | null> {
  const [row] = await db
    .update(squadJoinRequests)
    .set({ status: input.status, decidedBy: input.decidedBy, decidedAt: input.at })
    .where(
      and(
        eq(squadJoinRequests.guildId, guildId),
        eq(squadJoinRequests.id, requestId),
        inArray(squadJoinRequests.status, [...(input.from ?? SQUAD_OPEN_REQUEST_STATUSES)]),
      ),
    )
    .returning();
  return row ?? null;
}

/** Convites e pedidos abertos (`invited` e `pending`), do mais antigo. */
export async function listOpenJoinRequests(
  db: DbExecutor,
  guildId: string,
  squadId?: string,
): Promise<SquadJoinRequest[]> {
  const filters: SQL[] = [eq(squadJoinRequests.guildId, guildId), isOpenRequest()];
  if (squadId) filters.push(eq(squadJoinRequests.squadId, squadId));
  return db
    .select()
    .from(squadJoinRequests)
    .where(and(...filters))
    .orderBy(asc(squadJoinRequests.createdAt));
}

/** Abertos com o prazo vencido em `now`; o job decide cada um. */
export async function listDueJoinRequests(
  db: DbExecutor,
  guildId: string,
  now: Date,
): Promise<SquadJoinRequest[]> {
  return db
    .select()
    .from(squadJoinRequests)
    .where(
      and(
        eq(squadJoinRequests.guildId, guildId),
        isOpenRequest(),
        lte(squadJoinRequests.expiresAt, now),
      ),
    )
    .orderBy(asc(squadJoinRequests.expiresAt));
}

/** Os pedidos de uma pessoa para um squad criados em `since` ou depois, do mais novo. */
export async function listRecentJoinRequestsFor(
  db: DbExecutor,
  guildId: string,
  squadId: string,
  userId: string,
  since: Date,
): Promise<SquadJoinRequest[]> {
  return db
    .select()
    .from(squadJoinRequests)
    .where(
      and(
        eq(squadJoinRequests.guildId, guildId),
        eq(squadJoinRequests.squadId, squadId),
        eq(squadJoinRequests.userId, userId),
        gte(squadJoinRequests.createdAt, since),
      ),
    )
    .orderBy(desc(squadJoinRequests.createdAt));
}

/**
 * `joinRequestKey` de todo pedido de entrada da guild criado em `since` ou
 * depois, em qualquer status, sem repetição. É o cooldown do pedido: um
 * candidato que passou, que o squad recusou ou cujo convite expirou não é
 * convidado de novo a cada passada do matcher. Quem chama calcula `since`.
 */
export async function listRecentJoinRequestKeys(
  db: DbExecutor,
  guildId: string,
  since: Date,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ squadId: squadJoinRequests.squadId, userId: squadJoinRequests.userId })
    .from(squadJoinRequests)
    .where(and(eq(squadJoinRequests.guildId, guildId), gte(squadJoinRequests.createdAt, since)));
  return rows.map((row) => joinRequestKey(row.squadId, row.userId));
}

// ── sessões ─────────────────────────────────────────────────────────────────

export interface CreateSquadSessionInput {
  guildId: string;
  squadId: string;
  startsAt: Date;
  endsAt: Date;
  createdBy: string;
  /** Quem marca já vai: nasce com o próprio "vou". */
  goingIds: string[];
}

/**
 * Marca uma jogatina. `null` quando o squad já tem uma no mesmo minuto
 * (`(squad_id, starts_at)` é único): dois `/bora` iguais viram um só, e quem
 * chama lê a existente com `getSquadSessionAt`.
 */
export async function createSquadSession(
  db: DbExecutor,
  input: CreateSquadSessionInput,
): Promise<SquadSession | null> {
  const [row] = await db
    .insert(squadSessions)
    .values(input)
    .onConflictDoNothing({ target: [squadSessions.squadId, squadSessions.startsAt] })
    .returning();
  return row ?? null;
}

export async function getSquadSessionAt(
  db: DbExecutor,
  guildId: string,
  squadId: string,
  startsAt: Date,
): Promise<SquadSession | null> {
  const [row] = await db
    .select()
    .from(squadSessions)
    .where(
      and(
        eq(squadSessions.guildId, guildId),
        eq(squadSessions.squadId, squadId),
        eq(squadSessions.startsAt, startsAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface ReopenSquadSessionInput {
  endsAt: Date;
  createdBy: string;
  goingIds: string[];
}

/**
 * Marca de novo uma jogatina cancelada no mesmo minuto: a linha é a mesma (o
 * índice único não deixa outra), com votos, lembrete, início e reserva
 * zerados. `null` quando ela não está cancelada ou a reserva antiga ainda não
 * foi devolvida ao pool: zerar o snapshot antes da liberação deixaria o voice
 * trancado.
 */
export async function reopenSquadSession(
  db: DbExecutor,
  guildId: string,
  sessionId: number,
  input: ReopenSquadSessionInput,
): Promise<SquadSession | null> {
  const [row] = await db
    .update(squadSessions)
    .set({
      endsAt: input.endsAt,
      createdBy: input.createdBy,
      goingIds: input.goingIds,
      notGoingIds: [],
      remindedAt: null,
      messageId: null,
      startedAt: null,
      playedAt: null,
      cancelledAt: null,
      cancelledBy: null,
      calledAt: null,
      callChannelId: null,
      callMessageId: null,
      voiceChannelId: null,
      voiceOverwrites: null,
      voiceReservedAt: null,
      voiceReleasedAt: null,
    })
    .where(
      and(
        eq(squadSessions.guildId, guildId),
        eq(squadSessions.id, sessionId),
        isNotNull(squadSessions.cancelledAt),
        or(isNull(squadSessions.voiceReservedAt), isNotNull(squadSessions.voiceReleasedAt)),
      ),
    )
    .returning();
  return row ?? null;
}

export async function getSquadSession(
  db: DbExecutor,
  guildId: string,
  sessionId: number,
): Promise<SquadSession | null> {
  const [row] = await db
    .select()
    .from(squadSessions)
    .where(and(eq(squadSessions.guildId, guildId), eq(squadSessions.id, sessionId)))
    .limit(1);
  return row ?? null;
}

/** Sessões com início em `[from, to)`. */
export async function listSessionsStartingBetween(
  db: DbExecutor,
  guildId: string,
  from: Date,
  to: Date,
): Promise<SquadSession[]> {
  return db
    .select()
    .from(squadSessions)
    .where(
      and(
        eq(squadSessions.guildId, guildId),
        gte(squadSessions.startsAt, from),
        lt(squadSessions.startsAt, to),
      ),
    )
    .orderBy(asc(squadSessions.startsAt));
}

/** `null` quando o lembrete já saiu: o job de 5 em 5 min não lembra duas vezes. */
export async function markSessionReminded(
  db: DbExecutor,
  guildId: string,
  sessionId: number,
  at: Date,
): Promise<SquadSession | null> {
  const [row] = await db
    .update(squadSessions)
    .set({ remindedAt: at })
    .where(
      and(
        eq(squadSessions.guildId, guildId),
        eq(squadSessions.id, sessionId),
        isNull(squadSessions.remindedAt),
      ),
    )
    .returning();
  return row ?? null;
}

/** Grava a mensagem da jogatina, que os votos editam. */
export async function setSessionMessage(
  db: DbExecutor,
  guildId: string,
  sessionId: number,
  messageId: string,
): Promise<SquadSession | null> {
  const [row] = await db
    .update(squadSessions)
    .set({ messageId })
    .where(and(eq(squadSessions.guildId, guildId), eq(squadSessions.id, sessionId)))
    .returning();
  return row ?? null;
}

/**
 * `null` quando a jogatina já começou ou foi cancelada: os membros são movidos
 * para o voice uma vez só, e nunca para uma jogatina que não vai acontecer.
 */
export async function markSessionStarted(
  db: DbExecutor,
  guildId: string,
  sessionId: number,
  at: Date,
): Promise<SquadSession | null> {
  const [row] = await db
    .update(squadSessions)
    .set({ startedAt: at })
    .where(
      and(
        eq(squadSessions.guildId, guildId),
        eq(squadSessions.id, sessionId),
        isNull(squadSessions.startedAt),
        isNull(squadSessions.cancelledAt),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Jogatinas não canceladas que ainda não acabaram em `now`, da mais próxima
 * para a mais distante. Com `squadIds`, só as desses squads (lista vazia não
 * consulta nada).
 */
export async function listUpcomingSessions(
  db: DbExecutor,
  guildId: string,
  now: Date,
  options: { squadIds?: readonly string[] } = {},
): Promise<SquadSession[]> {
  const filters: SQL[] = [
    eq(squadSessions.guildId, guildId),
    isNull(squadSessions.cancelledAt),
    gt(squadSessions.endsAt, now),
  ];
  if (options.squadIds) {
    if (options.squadIds.length === 0) return [];
    filters.push(inArray(squadSessions.squadId, [...options.squadIds]));
  }
  return db
    .select()
    .from(squadSessions)
    .where(and(...filters))
    .orderBy(asc(squadSessions.startsAt));
}

/**
 * Cancela a jogatina que ainda não começou. `null` quando ela já estava
 * cancelada ou já começou: dois cliques em CANCELAR editam a mensagem uma vez.
 */
export async function cancelSquadSession(
  db: DbExecutor,
  guildId: string,
  sessionId: number,
  by: string,
  at: Date,
): Promise<SquadSession | null> {
  const [row] = await db
    .update(squadSessions)
    .set({ cancelledAt: at, cancelledBy: by })
    .where(
      and(
        eq(squadSessions.guildId, guildId),
        eq(squadSessions.id, sessionId),
        isNull(squadSessions.cancelledAt),
        isNull(squadSessions.startedAt),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * A trava do CHAMAR GENTE: uma chamada pública por jogatina, e só antes do
 * início. Gravada antes de postar no canal de busca. `null` quando já houve
 * chamada, a jogatina começou ou foi cancelada.
 */
export async function claimSessionCall(
  db: DbExecutor,
  guildId: string,
  sessionId: number,
  at: Date,
): Promise<SquadSession | null> {
  const [row] = await db
    .update(squadSessions)
    .set({ calledAt: at })
    .where(
      and(
        eq(squadSessions.guildId, guildId),
        eq(squadSessions.id, sessionId),
        isNull(squadSessions.calledAt),
        isNull(squadSessions.startedAt),
        isNull(squadSessions.cancelledAt),
      ),
    )
    .returning();
  return row ?? null;
}

/** Grava onde a chamada pública foi postada, depois da trava. */
export async function setSessionCallMessage(
  db: DbExecutor,
  guildId: string,
  sessionId: number,
  input: { channelId: string; messageId: string },
): Promise<SquadSession | null> {
  const [row] = await db
    .update(squadSessions)
    .set({ callChannelId: input.channelId, callMessageId: input.messageId })
    .where(and(eq(squadSessions.guildId, guildId), eq(squadSessions.id, sessionId)))
    .returning();
  return row ?? null;
}

/** Desfaz a trava da chamada que não chegou ao Discord: dá para chamar de novo. */
export async function releaseSessionCall(
  db: DbExecutor,
  guildId: string,
  sessionId: number,
): Promise<SquadSession | null> {
  const [row] = await db
    .update(squadSessions)
    .set({ calledAt: null, callChannelId: null, callMessageId: null })
    .where(
      and(
        eq(squadSessions.guildId, guildId),
        eq(squadSessions.id, sessionId),
        isNull(squadSessions.callMessageId),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Tira a chamada do ar: `call_message_id` volta a `null` e `called_at` fica,
 * para a jogatina não ser chamada de novo. `null` quando outra chamada já
 * tirou (início e cancelamento ao mesmo tempo apagam a mensagem uma vez).
 */
export async function closeSessionCall(
  db: DbExecutor,
  guildId: string,
  sessionId: number,
  messageId: string,
): Promise<SquadSession | null> {
  const [row] = await db
    .update(squadSessions)
    .set({ callMessageId: null })
    .where(
      and(
        eq(squadSessions.guildId, guildId),
        eq(squadSessions.id, sessionId),
        eq(squadSessions.callMessageId, messageId),
      ),
    )
    .returning();
  return row ?? null;
}

/** Jogatinas com chamada pública no ar, de um squad ou da guild. */
export async function listOpenSessionCalls(
  db: DbExecutor,
  guildId: string,
  options: { squadId?: string } = {},
): Promise<SquadSession[]> {
  const filters: SQL[] = [eq(squadSessions.guildId, guildId), isNotNull(squadSessions.callMessageId)];
  if (options.squadId) filters.push(eq(squadSessions.squadId, options.squadId));
  return db
    .select()
    .from(squadSessions)
    .where(and(...filters))
    .orderBy(asc(squadSessions.startsAt));
}

/** O primeiro sinal de que a jogatina rolou. `null` quando já estava marcada. */
export async function markSessionPlayed(
  db: DbExecutor,
  guildId: string,
  sessionId: number,
  at: Date,
): Promise<SquadSession | null> {
  const [row] = await db
    .update(squadSessions)
    .set({ playedAt: at })
    .where(
      and(
        eq(squadSessions.guildId, guildId),
        eq(squadSessions.id, sessionId),
        isNull(squadSessions.playedAt),
        isNull(squadSessions.cancelledAt),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * "Vou" (`going = true`) ou "Não vou": entra numa lista e sai da outra, numa
 * `UPDATE` só. `null` quando o voto já era esse, a jogatina foi cancelada ou
 * não existe.
 */
export async function voteSquadSession(
  db: DbExecutor,
  guildId: string,
  sessionId: number,
  userId: string,
  going: boolean,
): Promise<SquadSession | null> {
  const target = going ? squadSessions.goingIds : squadSessions.notGoingIds;
  const other = going ? squadSessions.notGoingIds : squadSessions.goingIds;
  const [row] = await db
    .update(squadSessions)
    .set(
      going
        ? { goingIds: appendId(target, userId), notGoingIds: removeId(other, userId) }
        : { notGoingIds: appendId(target, userId), goingIds: removeId(other, userId) },
    )
    .where(
      and(
        eq(squadSessions.guildId, guildId),
        eq(squadSessions.id, sessionId),
        isNull(squadSessions.cancelledAt),
        lacksId(target, userId),
      ),
    )
    .returning();
  return row ?? null;
}

export interface ReserveSessionVoiceInput {
  /**
   * `null` só no voice temporário: a reserva é gravada **antes** de o canal
   * existir, para um reinício no meio da criação deixar rastro no banco
   * (`listPendingTemporaryVoices`) em vez de um canal órfão sem dono.
   */
  voiceChannelId: string | null;
  /** Overwrites do voice antes da reserva: o que a liberação restaura. `null` no temporário. */
  overwrites: LockOverwrite[] | null;
  /** Voice criado só para esta sessão: a liberação o apaga. */
  temporary?: boolean;
  at: Date;
}

/**
 * Grava a reserva com o snapshot. `null` quando a sessão já tinha reserva:
 * uma segunda passada do job não sobrescreve o snapshot com os overwrites da
 * própria reserva.
 */
export async function reserveSessionVoice(
  db: DbExecutor,
  guildId: string,
  sessionId: number,
  input: ReserveSessionVoiceInput,
): Promise<SquadSession | null> {
  const [row] = await db
    .update(squadSessions)
    .set({
      voiceChannelId: input.voiceChannelId,
      voiceOverwrites: input.overwrites,
      voiceTemporary: input.temporary ?? false,
      voiceReservedAt: input.at,
    })
    .where(
      and(
        eq(squadSessions.guildId, guildId),
        eq(squadSessions.id, sessionId),
        isNull(squadSessions.voiceReservedAt),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Marca a liberação e devolve a linha com o snapshot para restaurar. `null`
 * quando não havia reserva ou ela já foi liberada: o restore roda uma vez.
 */
export async function releaseSessionVoice(
  db: DbExecutor,
  guildId: string,
  sessionId: number,
  at: Date,
): Promise<SquadSession | null> {
  const [row] = await db
    .update(squadSessions)
    .set({ voiceReleasedAt: at })
    .where(
      and(
        eq(squadSessions.guildId, guildId),
        eq(squadSessions.id, sessionId),
        isNotNull(squadSessions.voiceReservedAt),
        isNull(squadSessions.voiceReleasedAt),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * A sessão com reserva viva neste voice em `now`: reservada, não liberada e
 * com `starts_at - SQUAD_PRESENCE_LEAD_MS <= now < ends_at`. É o que o evento
 * de voz consulta para saber se quem entrou ou saiu mexe numa sessão de squad.
 */
export async function getActiveSessionByVoice(
  db: DbExecutor,
  guildId: string,
  voiceChannelId: string,
  now: Date,
): Promise<SquadSession | null> {
  const [row] = await db
    .select()
    .from(squadSessions)
    .where(
      and(
        eq(squadSessions.guildId, guildId),
        eq(squadSessions.voiceChannelId, voiceChannelId),
        isNotNull(squadSessions.voiceReservedAt),
        isNull(squadSessions.voiceReleasedAt),
        lte(squadSessions.startsAt, new Date(now.getTime() + SQUAD_PRESENCE_LEAD_MS)),
        gt(squadSessions.endsAt, now),
      ),
    )
    .orderBy(asc(squadSessions.startsAt))
    .limit(1);
  return row ?? null;
}

/**
 * Grava o id do voice temporário na reserva que foi feita antes de ele existir.
 * `null` quando a reserva já não está esperando canal: foi liberada no meio
 * (cancelamento) ou outra chamada já gravou um id. Quem chama apaga o canal.
 */
export async function setSessionTemporaryVoice(
  db: DbExecutor,
  guildId: string,
  sessionId: number,
  voiceChannelId: string,
): Promise<SquadSession | null> {
  const [row] = await db
    .update(squadSessions)
    .set({ voiceChannelId })
    .where(
      and(
        eq(squadSessions.guildId, guildId),
        eq(squadSessions.id, sessionId),
        eq(squadSessions.voiceTemporary, true),
        isNotNull(squadSessions.voiceReservedAt),
        isNull(squadSessions.voiceReleasedAt),
        isNull(squadSessions.voiceChannelId),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Reservas de voice temporário sem canal gravado, feitas entre `from` e `to`,
 * liberadas ou não. É o rastro de uma criação que não terminou: o bot caiu
 * entre pedir o canal e gravar o id, ou o Discord não respondeu. A
 * reconciliação procura o canal que pode ter nascido e o adota ou apaga.
 */
export async function listPendingTemporaryVoices(
  db: DbExecutor,
  guildId: string,
  from: Date,
  to: Date,
): Promise<SquadSession[]> {
  return db
    .select()
    .from(squadSessions)
    .where(
      and(
        eq(squadSessions.guildId, guildId),
        eq(squadSessions.voiceTemporary, true),
        isNull(squadSessions.voiceChannelId),
        gte(squadSessions.voiceReservedAt, from),
        lte(squadSessions.voiceReservedAt, to),
      ),
    )
    .orderBy(asc(squadSessions.voiceReservedAt));
}

/**
 * Voices temporários ainda de pé: reservados e não liberados. O evento de voz
 * carrega esta lista uma vez por guild e depois a mantém em memória, para não
 * consultar o banco a cada troca de canal fora do pool.
 */
export async function listLiveTemporaryVoiceIds(
  db: DbExecutor,
  guildId: string,
): Promise<string[]> {
  const rows = await db
    .select({ voiceChannelId: squadSessions.voiceChannelId })
    .from(squadSessions)
    .where(
      and(
        eq(squadSessions.guildId, guildId),
        eq(squadSessions.voiceTemporary, true),
        isNotNull(squadSessions.voiceReservedAt),
        isNull(squadSessions.voiceReleasedAt),
      ),
    );
  return rows.flatMap((row) => (row.voiceChannelId ? [row.voiceChannelId] : []));
}

/** Reservas ainda presas cuja janela terminou em `now`. */
export async function listSessionsToRelease(
  db: DbExecutor,
  guildId: string,
  now: Date,
): Promise<SquadSession[]> {
  return db
    .select()
    .from(squadSessions)
    .where(
      and(
        eq(squadSessions.guildId, guildId),
        isNotNull(squadSessions.voiceReservedAt),
        isNull(squadSessions.voiceReleasedAt),
        lte(squadSessions.endsAt, now),
      ),
    )
    .orderBy(asc(squadSessions.endsAt));
}

// ── histórico ───────────────────────────────────────────────────────────────

/** Jogatina que rolou: tem `played_at` e não foi cancelada. */
const playedSession = (): SQL =>
  and(isNotNull(squadSessions.playedAt), isNull(squadSessions.cancelledAt)) as SQL;

/**
 * As jogatinas que rolaram desde `since`, dos squads pedidos, da mais antiga
 * para a mais recente. Lista vazia de squads não consulta nada.
 */
export async function listPlayedSessions(
  db: DbExecutor,
  guildId: string,
  squadIds: readonly string[],
  since: Date,
): Promise<SquadSession[]> {
  if (squadIds.length === 0) return [];
  return db
    .select()
    .from(squadSessions)
    .where(
      and(
        eq(squadSessions.guildId, guildId),
        inArray(squadSessions.squadId, [...squadIds]),
        playedSession(),
        gte(squadSessions.startsAt, since),
      ),
    )
    .orderBy(asc(squadSessions.startsAt));
}

export interface PlayedSessionTotals {
  squadId: string;
  played: number;
  /** O início da última jogatina que rolou. */
  lastPlayedAt: Date | null;
}

/** Quantas jogatinas cada squad já jogou, sem janela. Squad que nunca jogou fica de fora. */
export async function countPlayedSessions(
  db: DbExecutor,
  guildId: string,
  squadIds: readonly string[],
): Promise<PlayedSessionTotals[]> {
  if (squadIds.length === 0) return [];
  const rows = await db
    .select({
      squadId: squadSessions.squadId,
      played: count(),
      lastPlayedAt: sql<Date | string | null>`max(${squadSessions.startsAt})`,
    })
    .from(squadSessions)
    .where(
      and(
        eq(squadSessions.guildId, guildId),
        inArray(squadSessions.squadId, [...squadIds]),
        playedSession(),
      ),
    )
    .groupBy(squadSessions.squadId);
  // `max()` num `sql` cru volta como texto do driver, não como `Date`.
  return rows.map((row) => ({
    squadId: row.squadId,
    played: Number(row.played),
    lastPlayedAt: row.lastPlayedAt === null ? null : new Date(row.lastPlayedAt),
  }));
}

export interface OpenAttendanceInput {
  guildId: string;
  sessionId: number;
  userId: string;
  joinedAt: Date;
}

/**
 * Alguém do squad entrou no voice reservado. Uma linha por entrada; o mesmo
 * instante duas vezes (evento repetido) não duplica.
 */
export async function openSessionAttendance(
  db: DbExecutor,
  input: OpenAttendanceInput,
): Promise<boolean> {
  const rows = await db
    .insert(squadSessionAttendance)
    .values(input)
    .onConflictDoNothing()
    .returning({ sessionId: squadSessionAttendance.sessionId });
  return rows.length > 0;
}

/**
 * A pessoa saiu de um voice do pool: fecha as entradas abertas dela na guild.
 * Por pessoa, e não por jogatina, porque ela só está num voice por vez e a
 * reserva pode ter sido liberada antes da saída. Devolve quantas fechou.
 */
export async function closeSessionAttendance(
  db: DbExecutor,
  guildId: string,
  userId: string,
  at: Date,
): Promise<number> {
  const rows = await db
    .update(squadSessionAttendance)
    .set({ leftAt: at })
    .where(
      and(
        eq(squadSessionAttendance.guildId, guildId),
        eq(squadSessionAttendance.userId, userId),
        isNull(squadSessionAttendance.leftAt),
      ),
    )
    .returning({ sessionId: squadSessionAttendance.sessionId });
  return rows.length;
}

export interface SessionAttendanceRow {
  sessionId: number;
  userId: string;
  joinedAt: Date;
  /** `null` = ainda no voice (ou saiu sem a varredura ter visto ainda). */
  leftAt: Date | null;
}

/**
 * As entradas no voice de cada jogatina, com o intervalo de cada uma. Quem
 * saiu e voltou aparece mais de uma vez: quem conta pessoas deduplica, quem
 * conta tempo junta os intervalos (`shared/squads/stats.ts`).
 */
export async function listSessionAttendance(
  db: DbExecutor,
  guildId: string,
  sessionIds: readonly number[],
): Promise<SessionAttendanceRow[]> {
  if (sessionIds.length === 0) return [];
  return db
    .select({
      sessionId: squadSessionAttendance.sessionId,
      userId: squadSessionAttendance.userId,
      joinedAt: squadSessionAttendance.joinedAt,
      leftAt: squadSessionAttendance.leftAt,
    })
    .from(squadSessionAttendance)
    .where(
      and(
        eq(squadSessionAttendance.guildId, guildId),
        inArray(squadSessionAttendance.sessionId, [...sessionIds]),
      ),
    )
    .orderBy(asc(squadSessionAttendance.joinedAt));
}

export interface OpenAttendanceRow {
  sessionId: number;
  userId: string;
  joinedAt: Date;
  /** O voice da jogatina, que continua gravado depois da liberação. */
  voiceChannelId: string | null;
}

/**
 * Toda presença aberta da guild, com o voice da jogatina dela. É o que a
 * varredura confere contra quem está em voice agora: linha aberta de quem não
 * está mais naquele voice saiu com o bot fora do ar.
 */
export async function listOpenAttendance(
  db: DbExecutor,
  guildId: string,
): Promise<OpenAttendanceRow[]> {
  return db
    .select({
      sessionId: squadSessionAttendance.sessionId,
      userId: squadSessionAttendance.userId,
      joinedAt: squadSessionAttendance.joinedAt,
      voiceChannelId: squadSessions.voiceChannelId,
    })
    .from(squadSessionAttendance)
    .innerJoin(squadSessions, eq(squadSessions.id, squadSessionAttendance.sessionId))
    .where(and(eq(squadSessionAttendance.guildId, guildId), isNull(squadSessionAttendance.leftAt)));
}

/**
 * Fecha uma presença só, pela chave inteira. `false` quando ela já estava
 * fechada: o evento de voz e a varredura podem chegar juntos, e quem fecha
 * primeiro vale.
 */
export async function closeAttendanceRow(
  db: DbExecutor,
  guildId: string,
  row: { sessionId: number; userId: string; joinedAt: Date },
  at: Date,
): Promise<boolean> {
  const rows = await db
    .update(squadSessionAttendance)
    .set({ leftAt: at })
    .where(
      and(
        eq(squadSessionAttendance.guildId, guildId),
        eq(squadSessionAttendance.sessionId, row.sessionId),
        eq(squadSessionAttendance.userId, row.userId),
        eq(squadSessionAttendance.joinedAt, row.joinedAt),
        isNull(squadSessionAttendance.leftAt),
      ),
    )
    .returning({ sessionId: squadSessionAttendance.sessionId });
  return rows.length > 0;
}
