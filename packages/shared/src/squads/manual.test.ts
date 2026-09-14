import { describe, expect, it } from 'vitest';

import { toBits } from './availability';
import {
  evaluateManualMatch,
  MANUAL_MATCH_ISSUE_CODES,
  MANUAL_MATCH_SEVERITY,
  manualMatchPeople,
  unconfirmedWarnings,
  type ManualMatchInput,
  type ManualMatchIssue,
  type ManualMatchPerson,
} from './manual';
import { pairKey, type SquadMatchField } from './match';

const FRIDAY_EVENING = toBits([{ day: 5, block: 2 }]);
const SATURDAY_EVENING = toBits([{ day: 6, block: 2 }]);
const SUNDAY_EVENING = toBits([{ day: 0, block: 2 }]);

const FIELDS: SquadMatchField[] = [
  { key: 'platform', type: 'select', match: 'hard' },
  { key: 'modes', type: 'tags', match: 'hard' },
  { key: 'mic', type: 'select', match: 'soft' },
];

const ID = (n: number) => `1000000000000000${String(n).padStart(2, '0')}`;
const [A, B, C, D] = [1, 2, 3, 4].map(ID) as [string, string, string, string];

const GAME_ID = 'game-1';
const OTHER_GAME_ID = 'game-2';

function person(userId: string, overrides: Partial<ManualMatchPerson> = {}): ManualMatchPerson {
  return {
    userId,
    availability: SATURDAY_EVENING,
    answers: {},
    status: 'searching',
    activeSquadCount: 0,
    squadIdsInGame: [],
    inOpenProposal: false,
    pendingRequestSquadIds: [],
    inGuild: true,
    ...overrides,
  };
}

function evaluate(people: ManualMatchPerson[], overrides: Partial<ManualMatchInput> = {}) {
  return evaluateManualMatch({
    game: { squadSize: 4, fields: FIELDS },
    maxSquadsPerUser: 1,
    userIds: people.map((entry) => entry.userId),
    people: new Map(people.map((entry) => [entry.userId, entry])),
    cooldownPairs: new Set(),
    ...overrides,
  });
}

const keys = (issues: readonly ManualMatchIssue[]) => issues.map((entry) => entry.key);

describe('evaluateManualMatch', () => {
  it('só bloqueia o que a proposta não comporta; o resto avisa', () => {
    const blocking = MANUAL_MATCH_ISSUE_CODES.filter(
      (code) => MANUAL_MATCH_SEVERITY[code] === 'block',
    );
    expect(blocking).toEqual([
      'PROFILE_NOT_FOUND',
      'NOT_IN_GUILD',
      'IN_SQUAD_IN_GAME',
      'IN_OPEN_PROPOSAL',
      'NO_COMMON_CELL',
    ]);
  });

  it('turma limpa: nota das duplas, janela na célula comum e nenhum aviso', () => {
    const result = evaluate([
      person(B, { answers: { mic: 'Sim' } }),
      person(A, { answers: { mic: 'Sim' } }),
    ]);

    expect(result).toEqual({
      userIds: [A, B],
      pairs: [
        { userIds: [A, B], score: 4, hardOk: true, commonCells: 1, cooldown: false, hardConflicts: [] },
      ],
      score: 4,
      commonMask: SATURDAY_EVENING,
      slot: { day: 6, block: 2 },
      blocks: [],
      warnings: [],
    });
  });

  it('turma maior que o squad só avisa', () => {
    const result = evaluate([person(A), person(B), person(C)], {
      game: { squadSize: 2, fields: FIELDS },
    });

    expect(result.blocks).toEqual([]);
    expect(result.warnings).toEqual([
      { key: 'GROUP_OVER_SIZE', code: 'GROUP_OVER_SIZE', severity: 'warning', userIds: [A, B, C] },
    ]);
  });

  it('membro de squad vivo deste jogo e perfil in_squad bloqueiam, cada um com a sua key', () => {
    const result = evaluate([
      person(A, { squadIdsInGame: ['squad-1'], activeSquadCount: 0 }),
      person(B, { status: 'in_squad' }),
      person(C),
    ]);

    expect(keys(result.blocks)).toEqual([`IN_SQUAD_IN_GAME:${A}`, `IN_SQUAD_IN_GAME:${B}`]);
    expect(result.blocks[0]).toMatchObject({ severity: 'block', userIds: [A] });
    // `in_squad` é bloqueio, não "não está procurando".
    expect(keys(result.warnings)).not.toContain(`NOT_SEARCHING:${B}`);
  });

  it('squad de outro jogo não bloqueia, mas conta no teto de squads', () => {
    const people = manualMatchPeople({
      gameId: GAME_ID,
      profiles: [A, B].map((userId) => ({
        userId,
        availability: SATURDAY_EVENING,
        answers: {},
        status: 'searching' as const,
      })),
      openProposals: [],
      liveSquads: [{ id: 'other', gameId: OTHER_GAME_ID, memberIds: [A] }],
      pendingRequests: [],
    });

    const result = evaluate([], { userIds: [A, B], people });

    expect(result.blocks).toEqual([]);
    expect(keys(result.warnings)).toEqual([`AT_SQUAD_LIMIT:${A}`]);
  });

  it('perfil pausado pode entrar, com aviso', () => {
    const result = evaluate([person(A, { status: 'paused' }), person(B)]);

    expect(result.blocks).toEqual([]);
    expect(keys(result.warnings)).toEqual([`NOT_SEARCHING:${A}`]);
  });

  it('proposta aberta e quem saiu do servidor bloqueiam; presença desconhecida não', () => {
    const result = evaluate([
      person(A, { inOpenProposal: true }),
      person(B, { inGuild: false }),
      person(C, { inGuild: null }),
    ]);

    expect(keys(result.blocks)).toEqual([`NOT_IN_GUILD:${B}`, `IN_OPEN_PROPOSAL:${A}`]);
  });

  it('sem célula do grupo inteiro bloqueia, mesmo com toda dupla compatível', () => {
    // A e B jogam sexta, A e C sábado, B e C domingo.
    const result = evaluate([
      person(A, { availability: FRIDAY_EVENING | SATURDAY_EVENING }),
      person(B, { availability: FRIDAY_EVENING | SUNDAY_EVENING }),
      person(C, { availability: SATURDAY_EVENING | SUNDAY_EVENING }),
    ]);

    expect(result.commonMask).toBe(0);
    expect(result.slot).toBeNull();
    expect(result.pairs.every((pair) => pair.commonCells === 1)).toBe(true);
    expect(result.blocks).toEqual([
      { key: 'NO_COMMON_CELL', code: 'NO_COMMON_CELL', severity: 'block', userIds: [A, B, C] },
    ]);
  });

  it('cooldown e campo hard divergente avisam por dupla, com os campos', () => {
    const result = evaluate(
      [
        person(A, { answers: { platform: 'PC', modes: ['Farm'] } }),
        person(B, { answers: { platform: 'PS5', modes: ['PvE'] } }),
        person(C, { answers: { platform: 'PC' } }),
      ],
      { cooldownPairs: new Set([pairKey(C, A)]) },
    );

    expect(result.warnings).toEqual([
      {
        key: `PAIR_COOLDOWN:${pairKey(A, C)}`,
        code: 'PAIR_COOLDOWN',
        severity: 'warning',
        userIds: [A, C],
      },
      {
        key: `HARD_MISMATCH:${pairKey(A, B)}`,
        code: 'HARD_MISMATCH',
        severity: 'warning',
        userIds: [A, B],
        fieldKeys: ['platform', 'modes'],
      },
      {
        key: `HARD_MISMATCH:${pairKey(B, C)}`,
        code: 'HARD_MISMATCH',
        severity: 'warning',
        userIds: [B, C],
        fieldKeys: ['platform'],
      },
    ]);
    expect(result.pairs.find((pair) => pair.userIds.join() === [A, C].join())).toMatchObject({
      cooldown: true,
      hardOk: true,
    });
  });

  it('pedido de entrada pendente avisa', () => {
    const result = evaluate([person(A, { pendingRequestSquadIds: ['squad-1'] }), person(B)]);

    expect(keys(result.warnings)).toEqual([`PENDING_JOIN_REQUEST:${A}`]);
  });

  it('quem não tem perfil vira só PROFILE_NOT_FOUND, sem dupla nem outra issue', () => {
    const result = evaluate([person(A), person(B)], { userIds: [A, D, B] });

    expect(result.userIds).toEqual([A, B, D]);
    expect(keys(result.blocks)).toEqual([`PROFILE_NOT_FOUND:${D}`]);
    expect(result.warnings).toEqual([]);
    expect(result.pairs.map((pair) => pair.userIds)).toEqual([[A, B]]);
  });

  it('a janela é a célula mais baixa entre as comuns', () => {
    const result = evaluate([
      person(A, { availability: FRIDAY_EVENING | SATURDAY_EVENING | SUNDAY_EVENING }),
      person(B, { availability: SATURDAY_EVENING | SUNDAY_EVENING }),
    ]);

    expect(result.commonMask).toBe(SATURDAY_EVENING | SUNDAY_EVENING);
    expect(result.slot).toEqual({ day: 0, block: 2 });
  });

  it('bloqueios e avisos saem na ordem dos códigos e depois da key', () => {
    const result = evaluate(
      [
        person(D, { status: 'paused', inOpenProposal: true }),
        person(C, { activeSquadCount: 3 }),
        person(B, { inGuild: false, pendingRequestSquadIds: ['s'] }),
        person(A, { status: 'paused' }),
      ],
      { game: { squadSize: 2, fields: FIELDS } },
    );

    const order = [...result.blocks, ...result.warnings].map((entry) =>
      MANUAL_MATCH_ISSUE_CODES.indexOf(entry.code),
    );
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(keys(result.warnings)).toEqual([
      'GROUP_OVER_SIZE',
      `NOT_SEARCHING:${A}`,
      `NOT_SEARCHING:${D}`,
      `AT_SQUAD_LIMIT:${C}`,
      `PENDING_JOIN_REQUEST:${B}`,
    ]);
  });

  it('é determinístico: ordem da entrada e seleção repetida não mudam a saída', () => {
    const people = [
      person(A, { answers: { platform: 'PC' }, status: 'paused' }),
      person(B, { answers: { platform: 'PS5', mic: 'Sim' } }),
      person(C, { answers: { mic: 'Sim' }, availability: SATURDAY_EVENING | SUNDAY_EVENING }),
    ];
    const expected = evaluate(people, { cooldownPairs: new Set([pairKey(A, B)]) });

    const shuffled = evaluateManualMatch({
      game: { squadSize: 4, fields: FIELDS },
      maxSquadsPerUser: 1,
      userIds: [C, A, B, A],
      people: new Map([...people].reverse().map((entry) => [entry.userId, entry])),
      cooldownPairs: new Set([pairKey(B, A)]),
    });

    expect(shuffled).toEqual(expected);
  });
});

describe('unconfirmedWarnings', () => {
  it('devolve só os avisos cuja key ainda não foi confirmada', () => {
    const result = evaluate([person(A, { status: 'paused' }), person(B, { status: 'paused' })]);

    expect(keys(unconfirmedWarnings(result, [`NOT_SEARCHING:${A}`]))).toEqual([
      `NOT_SEARCHING:${B}`,
    ]);
    expect(unconfirmedWarnings(result, [...keys(result.warnings), 'SOBROU'])).toEqual([]);
    expect(unconfirmedWarnings({ warnings: [] }, [])).toEqual([]);
  });
});

describe('manualMatchPeople', () => {
  const profile = (userId: string) => ({
    userId,
    availability: SATURDAY_EVENING,
    answers: {},
    status: 'searching' as const,
  });

  it('quem passou numa proposta está livre, e proposta de outro jogo não ocupa', () => {
    const people = manualMatchPeople({
      gameId: GAME_ID,
      profiles: [profile(A), profile(B), profile(C)],
      openProposals: [
        { gameId: GAME_ID, userIds: [A, B], declinedIds: [B] },
        { gameId: OTHER_GAME_ID, userIds: [C], declinedIds: [] },
      ],
      liveSquads: [],
      pendingRequests: [],
    });

    expect(people.get(A)?.inOpenProposal).toBe(true);
    expect(people.get(B)?.inOpenProposal).toBe(false);
    expect(people.get(C)?.inOpenProposal).toBe(false);
  });

  it('squads somam todos os jogos no teto, mas só os deste jogo ocupam', () => {
    const people = manualMatchPeople({
      gameId: GAME_ID,
      profiles: [profile(A), profile(B)],
      openProposals: [],
      liveSquads: [
        { id: 'here', gameId: GAME_ID, memberIds: [A] },
        { id: 'there', gameId: OTHER_GAME_ID, memberIds: [A, B] },
      ],
      pendingRequests: [],
    });

    expect(people.get(A)).toMatchObject({ activeSquadCount: 2, squadIdsInGame: ['here'] });
    expect(people.get(B)).toMatchObject({ activeSquadCount: 1, squadIdsInGame: [] });
  });

  it('pedido pendente só conta em squad vivo deste jogo', () => {
    const people = manualMatchPeople({
      gameId: GAME_ID,
      profiles: [profile(A), profile(B)],
      openProposals: [],
      liveSquads: [
        { id: 'here', gameId: GAME_ID, memberIds: [C] },
        { id: 'there', gameId: OTHER_GAME_ID, memberIds: [C] },
      ],
      pendingRequests: [
        { squadId: 'here', userId: A },
        { squadId: 'there', userId: B },
        { squadId: 'archived', userId: B },
      ],
    });

    expect(people.get(A)?.pendingRequestSquadIds).toEqual(['here']);
    expect(people.get(B)?.pendingRequestSquadIds).toEqual([]);
  });

  it('presença vem do mapa e, sem ele, é desconhecida', () => {
    const input = {
      gameId: GAME_ID,
      profiles: [profile(A), profile(B)],
      openProposals: [],
      liveSquads: [],
      pendingRequests: [],
    };

    const known = manualMatchPeople({ ...input, membership: new Map([[A, false]]) });
    expect(known.get(A)?.inGuild).toBe(false);
    expect(known.get(B)?.inGuild).toBeNull();
    expect(manualMatchPeople(input).get(A)?.inGuild).toBeNull();
    expect(manualMatchPeople(input).has(C)).toBe(false);
  });
});
