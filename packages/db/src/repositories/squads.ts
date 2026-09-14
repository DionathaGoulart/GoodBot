import {
  pairKey,
  type SquadAnswers,
  type SquadGameField,
  type SquadProfileStatus,
  type SquadStatus,
} from '@goodbot/shared';
import {
  and,
  asc,
  count,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
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
  squadSize: number;
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
  day: number;
  block: number;
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

/** Um "vou" ou alguém no voice: o squad está vivo. */
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

export interface CreateSquadJoinRequestInput {
  guildId: string;
  squadId: string;
  userId: string;
}

/** `null` quando a pessoa já tem um pedido pendente para este squad. */
export async function createSquadJoinRequest(
  db: DbExecutor,
  input: CreateSquadJoinRequestInput,
): Promise<SquadJoinRequest | null> {
  const [row] = await db
    .insert(squadJoinRequests)
    .values(input)
    .onConflictDoNothing({
      target: [squadJoinRequests.squadId, squadJoinRequests.userId],
      where: sql`status = 'pending'`,
    })
    .returning();
  return row ?? null;
}

/** Grava a mensagem com os botões, enviada depois da linha (o `custom_id` leva o id). */
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
 * Registra a recusa de um membro. É só um voto: o pedido só vira `declined`
 * (por `decideSquadJoinRequest`) quando todos os membros atuais recusaram.
 * `null` quando nada mudou: o pedido já foi decidido ou o membro já recusou.
 */
export async function declineSquadJoinRequestBy(
  db: DbExecutor,
  guildId: string,
  requestId: string,
  userId: string,
): Promise<SquadJoinRequest | null> {
  const [row] = await db
    .update(squadJoinRequests)
    .set({ declinedIds: appendId(squadJoinRequests.declinedIds, userId) })
    .where(
      and(
        eq(squadJoinRequests.guildId, guildId),
        eq(squadJoinRequests.id, requestId),
        eq(squadJoinRequests.status, 'pending'),
        lacksId(squadJoinRequests.declinedIds, userId),
      ),
    )
    .returning();
  return row ?? null;
}

export interface DecideSquadJoinRequestInput {
  status: 'accepted' | 'declined';
  decidedBy: string | null;
  at: Date;
}

/**
 * Decide o pedido enquanto ele ainda está pendente. `null` quando outro membro
 * já decidiu: dois cliques em "Aceitar" não põem a pessoa duas vezes.
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
        eq(squadJoinRequests.status, 'pending'),
      ),
    )
    .returning();
  return row ?? null;
}

export async function listPendingJoinRequests(
  db: DbExecutor,
  guildId: string,
  squadId?: string,
): Promise<SquadJoinRequest[]> {
  const filters: SQL[] = [
    eq(squadJoinRequests.guildId, guildId),
    eq(squadJoinRequests.status, 'pending'),
  ];
  if (squadId) filters.push(eq(squadJoinRequests.squadId, squadId));
  return db
    .select()
    .from(squadJoinRequests)
    .where(and(...filters))
    .orderBy(asc(squadJoinRequests.createdAt));
}

/** Expira os pendentes criados antes de `before` e devolve as linhas (para editar as mensagens). */
export async function expireSquadJoinRequestsBefore(
  db: DbExecutor,
  guildId: string,
  before: Date,
): Promise<SquadJoinRequest[]> {
  return db
    .update(squadJoinRequests)
    .set({ status: 'expired', decidedAt: sql`now()` })
    .where(
      and(
        eq(squadJoinRequests.guildId, guildId),
        eq(squadJoinRequests.status, 'pending'),
        lt(squadJoinRequests.createdAt, before),
      ),
    )
    .returning();
}

// ── sessões ─────────────────────────────────────────────────────────────────

export interface UpsertSquadSessionInput {
  guildId: string;
  squadId: string;
  startsAt: Date;
  endsAt: Date;
}

/**
 * A sessão da semana, criada uma vez por `(squad_id, starts_at)`. Rodar de
 * novo devolve a mesma linha (com `ends_at` acompanhando a faixa do config).
 */
export async function upsertSquadSession(
  db: DbExecutor,
  input: UpsertSquadSessionInput,
): Promise<SquadSession> {
  const [row] = await db
    .insert(squadSessions)
    .values(input)
    .onConflictDoUpdate({
      target: [squadSessions.squadId, squadSessions.startsAt],
      set: { endsAt: input.endsAt },
      setWhere: eq(squadSessions.guildId, input.guildId),
    })
    .returning();
  if (!row) throw new Error('UPSERT em squad_sessions não retornou linha');
  return row;
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

/** Grava a mensagem do lembrete, que os votos editam. */
export async function setSessionReminderMessage(
  db: DbExecutor,
  guildId: string,
  sessionId: number,
  messageId: string,
): Promise<SquadSession | null> {
  const [row] = await db
    .update(squadSessions)
    .set({ reminderMessageId: messageId })
    .where(and(eq(squadSessions.guildId, guildId), eq(squadSessions.id, sessionId)))
    .returning();
  return row ?? null;
}

/** `null` quando a sessão já começou: os membros são movidos para o voice uma vez só. */
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
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * "Vou" (`going = true`) ou "Não vou": entra numa lista e sai da outra, numa
 * `UPDATE` só. `null` quando o voto já era esse (ou a sessão não existe).
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
        lacksId(target, userId),
      ),
    )
    .returning();
  return row ?? null;
}

export interface ReserveSessionVoiceInput {
  voiceChannelId: string;
  /** Overwrites do voice antes da reserva: o que a liberação restaura. */
  overwrites: LockOverwrite[];
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
