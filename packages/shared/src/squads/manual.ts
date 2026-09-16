import { bestSlot, type SquadCell } from './availability';
import {
  hardConflicts,
  pairKey,
  scoreProfiles,
  type SquadMatchField,
  type SquadMatchProfile,
} from './match';

import type { SquadProfileStatus } from '../constants';

/**
 * Match manual: o admin escolhe a turma no painel e o bot abre a proposta.
 * Puro, sem IO. O painel chama para mostrar nota e avisos enquanto o admin
 * marca linhas; o bot chama de novo com dados frescos antes de escrever, então
 * "o que bloqueia" e "o que só pede confirmação" são a mesma regra nos dois.
 */

/** Ordem de exibição: bloqueios primeiro, depois avisos. */
export const MANUAL_MATCH_ISSUE_CODES = [
  'PROFILE_NOT_FOUND',
  'NOT_IN_GUILD',
  'IN_SQUAD_IN_GAME',
  'IN_OPEN_PROPOSAL',
  'NO_COMMON_CELL',
  'GROUP_OVER_SIZE',
  'NOT_SEARCHING',
  'AT_SQUAD_LIMIT',
  'PAIR_COOLDOWN',
  'HARD_MISMATCH',
  'PENDING_JOIN_REQUEST',
] as const;
export type ManualMatchIssueCode = (typeof MANUAL_MATCH_ISSUE_CODES)[number];
export type ManualMatchSeverity = 'block' | 'warning';

/**
 * Severidade fixa por código. Bloqueia só o que a proposta não comporta
 * (sem perfil, fora do servidor, já comprometido neste jogo, sem janela); o
 * resto o admin pode saber melhor que o algoritmo, então só avisa.
 */
export const MANUAL_MATCH_SEVERITY: Readonly<Record<ManualMatchIssueCode, ManualMatchSeverity>> = {
  PROFILE_NOT_FOUND: 'block',
  NOT_IN_GUILD: 'block',
  IN_SQUAD_IN_GAME: 'block',
  IN_OPEN_PROPOSAL: 'block',
  NO_COMMON_CELL: 'block',
  GROUP_OVER_SIZE: 'warning',
  NOT_SEARCHING: 'warning',
  AT_SQUAD_LIMIT: 'warning',
  PAIR_COOLDOWN: 'warning',
  HARD_MISMATCH: 'warning',
  PENDING_JOIN_REQUEST: 'warning',
};

export interface ManualMatchPerson extends SquadMatchProfile {
  status: SquadProfileStatus;
  /** Squads `open|full` em que está, em qualquer jogo (é o que `maxSquadsPerUser` conta). */
  activeSquadCount: number;
  /** Squads `open|full` deste jogo em que está. Não vazio (ou `status === 'in_squad'`) = `IN_SQUAD_IN_GAME`. */
  squadIdsInGame: readonly string[];
  /** Numa proposta aberta deste jogo sem ter passado. */
  inOpenProposal: boolean;
  /** Squads vivos deste jogo com pedido de entrada pendente desta pessoa. */
  pendingRequestSquadIds: readonly string[];
  /** `false` = saiu do servidor; `null` = não se sabe (painel com o bot fora do ar). */
  inGuild: boolean | null;
}

export interface ManualMatchInput {
  game: { partySize: number; fields: readonly SquadMatchField[] };
  maxSquadsPerUser: number;
  /** A seleção do admin; repetido conta uma vez. */
  userIds: readonly string[];
  /** Perfis deste jogo por `userId`. Ausente = sem perfil. */
  people: ReadonlyMap<string, ManualMatchPerson>;
  /** `pairKey` das duplas em cooldown. */
  cooldownPairs: ReadonlySet<string>;
}

export interface ManualMatchIssue {
  /** Estável entre revisões: `CODE`, `CODE:userId` ou `CODE:pairKey`. É o que a confirmação devolve. */
  key: string;
  code: ManualMatchIssueCode;
  severity: ManualMatchSeverity;
  userIds: string[];
  /** Só em `HARD_MISMATCH`. */
  fieldKeys?: string[];
}

export interface ManualMatchPair {
  userIds: [string, string];
  score: number;
  hardOk: boolean;
  commonCells: number;
  cooldown: boolean;
  hardConflicts: string[];
}

export interface ManualMatchEvaluation {
  /** Escolhidos sem repetição, em ordem de string (a mesma de `proposeGroups`). */
  userIds: string[];
  /** Todas as duplas dos escolhidos que têm perfil. */
  pairs: ManualMatchPair[];
  score: number;
  /** Células marcadas por todos os escolhidos com perfil. */
  commonMask: number;
  /** A célula mais baixa de `commonMask`; `null` sem célula comum. */
  slot: SquadCell | null;
  blocks: ManualMatchIssue[];
  warnings: ManualMatchIssue[];
}

const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const codeOrder = (code: ManualMatchIssueCode) => MANUAL_MATCH_ISSUE_CODES.indexOf(code);

function issue(
  code: ManualMatchIssueCode,
  suffix: string | null,
  userIds: string[],
  fieldKeys?: string[],
): ManualMatchIssue {
  return {
    key: suffix === null ? code : `${code}:${suffix}`,
    code,
    severity: MANUAL_MATCH_SEVERITY[code],
    userIds,
    ...(fieldKeys ? { fieldKeys } : {}),
  };
}

/**
 * Avalia a turma escolhida pelo admin: duplas com nota, janela sugerida,
 * bloqueios e avisos. A mesma entrada em qualquer ordem dá a mesma saída.
 * Quem não tem perfil vira `PROFILE_NOT_FOUND` e mais nada: sem perfil não há
 * grade nem respostas para cruzar.
 */
export function evaluateManualMatch(input: ManualMatchInput): ManualMatchEvaluation {
  const userIds = [...new Set(input.userIds)].sort(compareIds);
  const issues: ManualMatchIssue[] = [];
  const present: ManualMatchPerson[] = [];

  for (const userId of userIds) {
    const person = input.people.get(userId);
    if (!person) {
      issues.push(issue('PROFILE_NOT_FOUND', userId, [userId]));
      continue;
    }
    present.push(person);
    if (person.inGuild === false) issues.push(issue('NOT_IN_GUILD', userId, [userId]));
    if (person.squadIdsInGame.length > 0 || person.status === 'in_squad') {
      issues.push(issue('IN_SQUAD_IN_GAME', userId, [userId]));
    }
    if (person.inOpenProposal) issues.push(issue('IN_OPEN_PROPOSAL', userId, [userId]));
    if (person.status === 'paused') issues.push(issue('NOT_SEARCHING', userId, [userId]));
    if (person.activeSquadCount >= input.maxSquadsPerUser) {
      issues.push(issue('AT_SQUAD_LIMIT', userId, [userId]));
    }
    if (person.pendingRequestSquadIds.length > 0) {
      issues.push(issue('PENDING_JOIN_REQUEST', userId, [userId]));
    }
  }

  // A proposta monta uma party, como a do match automático. Turma maior não
  // joga toda na mesma partida, e passando do squad sobra gente sem vaga.
  if (userIds.length > input.game.partySize) {
    issues.push(issue('GROUP_OVER_SIZE', null, [...userIds]));
  }

  const commonMask =
    present.length === 0 ? 0 : present.reduce((mask, person) => mask & person.availability, ~0);
  // Toda célula de `commonMask` tem todo mundo, então o empate é geral e fica
  // com o bit mais baixo, como no `proposeGroups`.
  const best = commonMask === 0 ? null : bestSlot([commonMask]);
  const slot = best ? { day: best.day, block: best.block } : null;
  if (present.length > 0 && commonMask === 0) {
    issues.push(
      issue(
        'NO_COMMON_CELL',
        null,
        present.map((person) => person.userId),
      ),
    );
  }

  const pairs: ManualMatchPair[] = [];
  let score = 0;
  present.forEach((a, index) => {
    for (const b of present.slice(index + 1)) {
      const pair = scoreProfiles(input.game.fields, a, b);
      const key = pairKey(a.userId, b.userId);
      const conflicts = hardConflicts(input.game.fields, a, b);
      const cooldown = input.cooldownPairs.has(key);
      pairs.push({
        userIds: [a.userId, b.userId],
        score: pair.score,
        hardOk: pair.hardOk,
        commonCells: pair.commonCells,
        cooldown,
        hardConflicts: conflicts,
      });
      score += pair.score;
      if (cooldown) issues.push(issue('PAIR_COOLDOWN', key, [a.userId, b.userId]));
      if (conflicts.length > 0) {
        issues.push(issue('HARD_MISMATCH', key, [a.userId, b.userId], conflicts));
      }
    }
  });

  issues.sort((x, y) => codeOrder(x.code) - codeOrder(y.code) || compareIds(x.key, y.key));
  return {
    userIds,
    pairs,
    score,
    commonMask,
    slot,
    blocks: issues.filter((entry) => entry.severity === 'block'),
    warnings: issues.filter((entry) => entry.severity === 'warning'),
  };
}

/** Avisos da avaliação cuja `key` não está em `confirmed`. */
export function unconfirmedWarnings(
  evaluation: Pick<ManualMatchEvaluation, 'warnings'>,
  confirmed: Iterable<string>,
): ManualMatchIssue[] {
  const seen = new Set(confirmed);
  return evaluation.warnings.filter((warning) => !seen.has(warning.key));
}

export interface ManualMatchPeopleInput {
  gameId: string;
  /** Perfis deste jogo, em qualquer status. */
  profiles: ReadonlyArray<SquadMatchProfile & { status: SquadProfileStatus }>;
  /** Propostas abertas da guild; as de outro jogo são ignoradas. */
  openProposals: ReadonlyArray<{
    gameId: string;
    userIds: readonly string[];
    declinedIds: readonly string[];
  }>;
  /** Squads `open|full` da guild, de todos os jogos, com os membros. */
  liveSquads: ReadonlyArray<{ id: string; gameId: string; memberIds: readonly string[] }>;
  /** Pedidos de entrada pendentes da guild. */
  pendingRequests: ReadonlyArray<{ squadId: string; userId: string }>;
  /** `userId -> está no servidor`; ausente vira `null`. */
  membership?: ReadonlyMap<string, boolean>;
}

/**
 * Monta `people` a partir de linhas puras, sem tipo do banco. Bot e painel
 * chamam a mesma função, então "está ocupado" significa a mesma coisa nos
 * dois lados. As regras de ocupação são as do `candidates()` do matcher:
 * quem passou numa proposta está livre, e pedido só conta em squad vivo
 * deste jogo.
 */
export function manualMatchPeople(input: ManualMatchPeopleInput): Map<string, ManualMatchPerson> {
  const inProposal = new Set<string>();
  for (const proposal of input.openProposals) {
    if (proposal.gameId !== input.gameId) continue;
    for (const userId of proposal.userIds) {
      if (!proposal.declinedIds.includes(userId)) inProposal.add(userId);
    }
  }

  const squadCount = new Map<string, number>();
  const squadsInGame = new Map<string, string[]>();
  const gameSquadIds = new Set<string>();
  for (const squad of input.liveSquads) {
    const inGame = squad.gameId === input.gameId;
    if (inGame) gameSquadIds.add(squad.id);
    for (const userId of new Set(squad.memberIds)) {
      squadCount.set(userId, (squadCount.get(userId) ?? 0) + 1);
      if (inGame) squadsInGame.set(userId, [...(squadsInGame.get(userId) ?? []), squad.id]);
    }
  }

  const requests = new Map<string, string[]>();
  for (const request of input.pendingRequests) {
    if (!gameSquadIds.has(request.squadId)) continue;
    requests.set(request.userId, [...(requests.get(request.userId) ?? []), request.squadId]);
  }

  const people = new Map<string, ManualMatchPerson>();
  for (const profile of input.profiles) {
    if (people.has(profile.userId)) continue;
    people.set(profile.userId, {
      userId: profile.userId,
      availability: profile.availability,
      answers: profile.answers,
      status: profile.status,
      activeSquadCount: squadCount.get(profile.userId) ?? 0,
      squadIdsInGame: squadsInGame.get(profile.userId) ?? [],
      inOpenProposal: inProposal.has(profile.userId),
      pendingRequestSquadIds: requests.get(profile.userId) ?? [],
      inGuild: input.membership?.get(profile.userId) ?? null,
    });
  }
  return people;
}
