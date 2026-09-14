import { MIN_SQUAD_SIZE, SQUAD_MATCH_WEIGHTS } from '../constants';
import { bestSlot, countCells, overlap, type SquadCell } from './availability';

import type { SquadAnswers, SquadAnswerValue, SquadGameField } from '../config/squads';

/**
 * Match de squads: puro, sem IO. O bot lê os perfis e as duplas em cooldown do
 * banco, chama `proposeGroups` e decide o que fazer com cada grupo.
 */

/** O que o match precisa saber de um campo do jogo. */
export type SquadMatchField = Pick<SquadGameField, 'key' | 'type' | 'match'>;

export interface SquadMatchProfile {
  userId: string;
  /** Máscara da grade (ver `availability.ts`). */
  availability: number;
  answers: SquadAnswers;
}

export interface SquadPairScore {
  score: number;
  /** `false` quando algum campo `hard` respondido pelos dois não bate. */
  hardOk: boolean;
  commonCells: number;
}

export interface SquadGroupProposal {
  /** Em ordem de `userId`. */
  userIds: string[];
  /** Células que todos do grupo têm marcadas; nunca zero. */
  mask: number;
  /** A janela semanal sugerida para o squad. */
  slot: SquadCell;
}

export interface ProposeGroupsOptions {
  /** Duplas que não podem ser propostas agora (cooldown), em `pairKey`. */
  blockedPairs?: ReadonlySet<string>;
}

function answerOf(profile: SquadMatchProfile, key: string): string[] {
  if (!Object.hasOwn(profile.answers, key)) return [];
  const value: SquadAnswerValue | undefined = profile.answers[key];
  if (typeof value === 'string') return value === '' ? [] : [value];
  return Array.isArray(value) ? value : [];
}

/**
 * As respostas batem? `select` bate quando é igual; `tags`, quando as listas
 * têm algo em comum (a mesma regra, já que um select é uma lista de um).
 * `null` quando um dos dois não respondeu: não dá para dizer que não bate, e
 * barrar quem pulou um campo opcional puniria justamente quem é flexível.
 */
function answersMatch(a: readonly string[], b: readonly string[]): boolean | null {
  if (a.length === 0 || b.length === 0) return null;
  return a.some((value) => b.includes(value));
}

/** Nota de uma dupla: faixas em comum e campos soft, com os pesos de `SQUAD_MATCH_WEIGHTS`. */
export function scoreProfiles(
  fields: readonly SquadMatchField[],
  a: SquadMatchProfile,
  b: SquadMatchProfile,
): SquadPairScore {
  const commonCells = countCells(overlap(a.availability, b.availability));
  let hardOk = true;
  let softMatches = 0;
  for (const field of fields) {
    // Texto livre nunca entra no match, nem se o jsonb vier com `match` errado.
    if (field.match === 'none' || field.type === 'text') continue;
    const matches = answersMatch(answerOf(a, field.key), answerOf(b, field.key));
    if (matches === null) continue;
    if (field.match === 'hard') {
      if (!matches) hardOk = false;
    } else if (matches) {
      softMatches++;
    }
  }
  return {
    score: commonCells * SQUAD_MATCH_WEIGHTS.cell + softMatches * SQUAD_MATCH_WEIGHTS.soft,
    hardOk,
    commonCells,
  };
}

/** Uma dupla pode jogar junta: nenhum campo hard contra e ao menos uma faixa em comum. */
export function isCompatiblePair(pair: SquadPairScore): boolean {
  return pair.hardOk && pair.commonCells >= 1;
}

/**
 * Chave estável de uma dupla, igual nos dois sentidos. É o que o cooldown de
 * "mesma dupla não é reproposta" guarda e consulta.
 */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Chave de um pedido de entrada: squad e candidato. É o que o cooldown de
 * "squad que recusou não é perguntado de novo" guarda e consulta.
 */
export function joinRequestKey(squadId: string, userId: string): string {
  return `${squadId}:${userId}`;
}

const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Monta grupos a partir dos perfis que estão procurando, de forma gulosa e
 * determinística:
 *
 * 1. a semente é a dupla compatível de maior nota entre quem ainda está livre;
 * 2. o grupo cresce, até `squadSize`, pelo candidato compatível com todos os
 *    membros que mantém alguma faixa em comum com o grupo inteiro e soma mais
 *    nota com eles;
 * 3. repete até não sobrar dupla compatível.
 *
 * O grupo inteiro precisa dividir uma faixa porque o squad tem uma janela só
 * por semana; compatibilidade de dupla em dupla não garante isso (A e B jogam
 * sexta, B e C sábado, A e C domingo). Cada jogador fica em no máximo um
 * grupo. Empates vão para o menor `userId` (ordem de string), então a mesma
 * entrada em qualquer ordem dá a mesma saída. Perfil repetido conta uma vez.
 */
export function proposeGroups(
  game: { squadSize: number; fields: readonly SquadMatchField[] },
  profiles: readonly SquadMatchProfile[],
  options: ProposeGroupsOptions = {},
): SquadGroupProposal[] {
  if (!Number.isInteger(game.squadSize) || game.squadSize < MIN_SQUAD_SIZE) {
    throw new RangeError(`Tamanho de squad inválido: ${String(game.squadSize)}.`);
  }
  const blocked = options.blockedPairs ?? new Set<string>();

  const unique = new Map<string, SquadMatchProfile>();
  for (const profile of profiles) {
    if (!unique.has(profile.userId)) unique.set(profile.userId, profile);
  }
  const people = [...unique.values()].sort((a, b) => compareIds(a.userId, b.userId));
  const count = people.length;

  // Nota de toda dupla compatível e fora do cooldown; dupla ausente = não pode.
  const scores = new Map<number, number>();
  const seeds: Array<{ i: number; j: number; score: number }> = [];
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const a = people[i]!;
      const b = people[j]!;
      if (blocked.has(pairKey(a.userId, b.userId))) continue;
      const pair = scoreProfiles(game.fields, a, b);
      if (!isCompatiblePair(pair)) continue;
      scores.set(i * count + j, pair.score);
      seeds.push({ i, j, score: pair.score });
    }
  }
  seeds.sort((x, y) => y.score - x.score || x.i - y.i || x.j - y.j);
  const scoreOf = (x: number, y: number) => scores.get(x < y ? x * count + y : y * count + x);

  // Quem entra num grupo não sai: a primeira semente livre na lista ordenada é
  // sempre a melhor dupla entre quem sobrou.
  const taken = new Set<number>();
  const groups: SquadGroupProposal[] = [];
  for (const seed of seeds) {
    if (taken.has(seed.i) || taken.has(seed.j)) continue;
    const members = [seed.i, seed.j];
    let mask = people[seed.i]!.availability & people[seed.j]!.availability;

    while (members.length < game.squadSize) {
      let best = -1;
      let bestGain = -1;
      for (let candidate = 0; candidate < count; candidate++) {
        if (taken.has(candidate) || members.includes(candidate)) continue;
        if ((mask & people[candidate]!.availability) === 0) continue;
        let gain = 0;
        let compatible = true;
        for (const member of members) {
          const score = scoreOf(candidate, member);
          if (score === undefined) {
            compatible = false;
            break;
          }
          gain += score;
        }
        if (compatible && gain > bestGain) {
          best = candidate;
          bestGain = gain;
        }
      }
      if (best < 0) break;
      members.push(best);
      mask &= people[best]!.availability;
    }

    members.sort((x, y) => x - y);
    for (const member of members) taken.add(member);
    // Toda célula de `mask` está marcada por todos, então a melhor célula é
    // sempre uma delas.
    const slot = bestSlot(members.map((member) => people[member]!.availability))!;
    groups.push({
      userIds: members.map((member) => people[member]!.userId),
      mask,
      slot: { day: slot.day, block: slot.block },
    });
  }
  return groups;
}
