import {
  hardConflicts,
  manualMatchPeople,
  pairKey,
  scoreProfiles,
  SQUAD_CELLS,
  SQUAD_PROFILE_STATUSES,
  type ManualMatchPerson,
  type SquadAnswers,
  type SquadFieldMatch,
  type SquadFieldType,
  type SquadGameField,
  type SquadOpenRequestStatus,
  type SquadProfileStatus,
  type SquadProposalSummary,
} from '@goodbot/shared';

/**
 * A aba JOGADORES em funções puras, sem `server-only`: a página carrega os
 * dados no servidor e a aba (client component) monta linhas, contadores e a
 * nota da seleção daqui, recalculando quando o filtro ou a seleção mudam.
 */

/** Um perfil de squad como o painel carrega do banco, com datas em ISO. */
export interface PlayerProfileRow extends Record<string, unknown> {
  userId: string;
  gameId: string;
  status: SquadProfileStatus;
  availability: number;
  answers: SquadAnswers;
  createdAt: string;
  updatedAt: string;
  lastMatchedAt: string | null;
}

/** Squad `open|full`, de qualquer jogo, com os membros. */
export interface LiveSquadRow {
  id: string;
  gameId: string;
  name: string;
  status: 'open' | 'full';
  textChannelId: string | null;
  memberIds: string[];
}

/** Convite (`invited`, esperando a pessoa) ou pedido em votação (`pending`, esperando o squad). */
export interface PendingRequestRow {
  id: string;
  squadId: string;
  userId: string;
  status: SquadOpenRequestStatus;
  createdAt: string;
}

export interface MemberSummaryRow {
  displayName: string;
  username: string;
  avatarUrl: string | null;
}

/** Tudo que a aba JOGADORES precisa, carregado uma vez por página. */
export interface SquadPlayersData {
  profiles: PlayerProfileRow[];
  openProposals: SquadProposalSummary[];
  liveSquads: LiveSquadRow[];
  pendingRequests: PendingRequestRow[];
  /** `gameId -> pairKey[]` das duplas dentro de `reproposeCooldownDays`. */
  cooldownPairs: Record<string, string[]>;
  members: Record<string, MemberSummaryRow>;
  /** Confirmados fora do servidor. */
  missingMemberIds: string[];
  /** O bot não conseguiu conferir: o nome cai para o ID e a presença fica desconhecida. */
  unresolvedMemberIds: string[];
  /** Bot fora do ar: nomes caem para o ID, o resto funciona. */
  membersError: string | null;
}

export interface PlayerRow extends PlayerProfileRow {
  /** Nome no servidor; o ID quando o bot não respondeu ou a pessoa saiu. */
  name: string;
  username: string | null;
  avatarUrl: string | null;
  /** `false` = saiu do servidor; `null` = o bot não conseguiu conferir. */
  inGuild: boolean | null;
  /** Squads vivos deste jogo em que a pessoa está. */
  squadIds: string[];
  /** Propostas abertas deste jogo em que a pessoa não passou. */
  openProposalIds: string[];
  /** Squads vivos deste jogo com convite ou pedido de entrada aberto dela. */
  pendingRequestSquadIds: string[];
  /** Squads vivos em todos os jogos: é o que `maxSquadsPerUser` conta. */
  activeSquadCount: number;
  /** Membro de squad vivo deste jogo ou `in_squad`: não entra no match manual. */
  inSquadInGame: boolean;
}

/** `userId -> está no servidor`, no formato que `manualMatchPeople` lê. */
export function membershipOf(
  data: Pick<SquadPlayersData, 'members' | 'missingMemberIds'>,
): Map<string, boolean> {
  const membership = new Map<string, boolean>();
  for (const userId of Object.keys(data.members)) membership.set(userId, true);
  for (const userId of data.missingMemberIds) membership.set(userId, false);
  return membership;
}

/**
 * As pessoas deste jogo como o match manual as vê. É a mesma função que o bot
 * chama, então "ocupado" quer dizer a mesma coisa na tabela e na revisão.
 */
export function playersPeople(
  data: SquadPlayersData,
  gameId: string,
): Map<string, ManualMatchPerson> {
  return manualMatchPeople({
    gameId,
    profiles: data.profiles.filter((profile) => profile.gameId === gameId),
    openProposals: data.openProposals,
    liveSquads: data.liveSquads,
    pendingRequests: data.pendingRequests,
    membership: membershipOf(data),
  });
}

export function buildPlayerRows(data: SquadPlayersData, gameId: string): PlayerRow[] {
  const people = playersPeople(data, gameId);
  return data.profiles
    .filter((profile) => profile.gameId === gameId)
    .map((profile) => {
      const person = people.get(profile.userId);
      const member = data.members[profile.userId];
      const squadIds = [...(person?.squadIdsInGame ?? [])];
      return {
        ...profile,
        name: member?.displayName ?? profile.userId,
        username: member?.username ?? null,
        avatarUrl: member?.avatarUrl ?? null,
        inGuild: person?.inGuild ?? null,
        squadIds,
        openProposalIds: data.openProposals
          .filter(
            (proposal) =>
              proposal.gameId === gameId &&
              proposal.userIds.includes(profile.userId) &&
              !proposal.declinedIds.includes(profile.userId),
          )
          .map((proposal) => proposal.id),
        pendingRequestSquadIds: [...(person?.pendingRequestSquadIds ?? [])],
        activeSquadCount: person?.activeSquadCount ?? 0,
        inSquadInGame: squadIds.length > 0 || profile.status === 'in_squad',
      };
    });
}

// ── Contadores ──────────────────────────────────────────────────────────────

export interface AnswerOptionCount {
  option: string;
  count: number;
}

export interface AnswerSummary {
  key: string;
  label: string;
  match: SquadFieldMatch;
  type: SquadFieldType;
  /** Uma entrada por opção do campo, na ordem do campo; vazio em texto livre. */
  options: AnswerOptionCount[];
  answered: number;
  unanswered: number;
}

export interface PlayersSummary {
  /** Todos os perfis do jogo, sem o filtro de status. */
  total: number;
  /** Também sem o filtro: os blocos de status mostram o jogo inteiro. */
  byStatus: Record<SquadProfileStatus, number>;
  /** Com o filtro de status. */
  answers: AnswerSummary[];
  /** Com o filtro de status; 28 posições, índice = bit da célula. */
  grid: number[];
  /** Quantos perfis passaram no filtro. */
  scoped: number;
}

function answerValues(answers: SquadAnswers, key: string): string[] {
  if (!Object.hasOwn(answers, key)) return [];
  const value = answers[key];
  if (typeof value === 'string') return value.trim() === '' ? [] : [value];
  return Array.isArray(value) ? value : [];
}

export function summarizePlayers(
  fields: readonly SquadGameField[],
  rows: readonly Pick<PlayerRow, 'status' | 'availability' | 'answers'>[],
  statuses?: readonly SquadProfileStatus[],
): PlayersSummary {
  const byStatus = Object.fromEntries(SQUAD_PROFILE_STATUSES.map((status) => [status, 0])) as Record<
    SquadProfileStatus,
    number
  >;
  for (const row of rows) byStatus[row.status] += 1;

  const scoped =
    statuses && statuses.length > 0 ? rows.filter((row) => statuses.includes(row.status)) : rows;

  const grid = Array.from({ length: SQUAD_CELLS }, () => 0);
  for (const row of scoped) {
    for (let bit = 0; bit < SQUAD_CELLS; bit++) {
      if (row.availability & (1 << bit)) grid[bit] = (grid[bit] ?? 0) + 1;
    }
  }

  const answers = fields.map((field): AnswerSummary => {
    const counts = new Map(field.options.map((option) => [option, 0]));
    let answered = 0;
    for (const row of scoped) {
      const values = answerValues(row.answers, field.key);
      if (values.length === 0) continue;
      answered += 1;
      if (field.type === 'text') continue;
      for (const value of new Set(values)) {
        const current = counts.get(value);
        // Resposta fora das opções atuais (o admin mudou o campo) não vira barra.
        if (current !== undefined) counts.set(value, current + 1);
      }
    }
    return {
      key: field.key,
      label: field.label,
      match: field.match,
      type: field.type,
      options:
        field.type === 'text'
          ? []
          : field.options.map((option) => ({ option, count: counts.get(option) ?? 0 })),
      answered,
      unanswered: scoped.length - answered,
    };
  });

  return { total: rows.length, byStatus, answers, grid, scoped: scoped.length };
}

// ── Seleção do match manual ─────────────────────────────────────────────────

/** Como uma linha fora da seleção combina com quem já foi marcado. */
export interface SelectionNote {
  /** Soma das notas de dupla contra cada selecionado. */
  score: number;
  /** Algum campo `hard` bate de frente com algum selecionado. */
  hardConflict: boolean;
  /** Nenhuma célula em comum com o grupo marcado. */
  noCommonCell: boolean;
  /** Alguma dupla com um selecionado está no cooldown. */
  cooldown: boolean;
  paused: boolean;
}

export function selectionNotes(
  fields: readonly SquadGameField[],
  rows: readonly PlayerRow[],
  selectedIds: ReadonlySet<string>,
  cooldownPairs: ReadonlySet<string>,
): Map<string, SelectionNote> {
  const notes = new Map<string, SelectionNote>();
  const selected = rows.filter((row) => selectedIds.has(row.userId));
  if (selected.length === 0) return notes;
  const mask = selected.reduce((common, row) => common & row.availability, ~0);

  for (const row of rows) {
    if (selectedIds.has(row.userId)) continue;
    notes.set(row.userId, {
      score: selected.reduce((sum, other) => sum + scoreProfiles(fields, row, other).score, 0),
      hardConflict: selected.some((other) => hardConflicts(fields, row, other).length > 0),
      noCommonCell: (mask & row.availability) === 0,
      cooldown: selected.some((other) => cooldownPairs.has(pairKey(row.userId, other.userId))),
      paused: row.status === 'paused',
    });
  }
  return notes;
}
