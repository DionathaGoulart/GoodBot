import {
  pairKey,
  scoreProfiles,
  toBits,
  type SquadCell,
  type SquadGameField,
  type SquadProposalSummary,
} from '@goodbot/shared';
import { describe, expect, it } from 'vitest';

import {
  buildPlayerRows,
  selectionNotes,
  summarizePlayers,
  type LiveSquadRow,
  type PlayerProfileRow,
  type PlayerRow,
  type SquadPlayersData,
} from './squad-players';

const GAME = '11111111-1111-4111-8111-111111111111';
const OTHER_GAME = '22222222-2222-4222-8222-222222222222';
const ALFA = '33333333-3333-4333-8333-333333333333';
const BRAVO = '44444444-4444-4444-8444-444444444444';

const ANA = '300000000000000001';
const BIA = '300000000000000002';
const CAU = '300000000000000003';
const DAN = '300000000000000004';
const EVA = '300000000000000005';

const SAT_NIGHT: SquadCell = { day: 6, block: 2 };
const SUN_MORNING: SquadCell = { day: 0, block: 0 };

const FIELDS: SquadGameField[] = [
  {
    key: 'plataforma',
    label: 'Plataforma',
    type: 'select',
    options: ['PC', 'PS5'],
    required: true,
    match: 'hard',
  },
  {
    key: 'frente',
    label: 'Frente',
    type: 'tags',
    options: ['Bots', 'Bugs'],
    required: false,
    match: 'soft',
  },
  { key: 'nick', label: 'Nick', type: 'text', options: [], required: false, match: 'none' },
];

function profile(userId: string, overrides: Partial<PlayerProfileRow> = {}): PlayerProfileRow {
  return {
    userId,
    gameId: GAME,
    status: 'searching',
    availability: toBits([SAT_NIGHT]),
    answers: {},
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-10T12:00:00.000Z',
    lastMatchedAt: null,
    ...overrides,
  };
}

function proposal(id: string, overrides: Partial<SquadProposalSummary> = {}): SquadProposalSummary {
  return {
    id,
    gameId: GAME,
    userIds: [],
    acceptedIds: [],
    declinedIds: [],
    squadId: null,
    threadId: '500000000000000001',
    expiresAt: '2026-09-15T12:00:00.000Z',
    createdAt: '2026-09-14T12:00:00.000Z',
    ...overrides,
  };
}

function squad(id: string, gameId: string, memberIds: string[]): LiveSquadRow {
  return { id, gameId, name: id, status: 'open', day: 6, block: 2, textChannelId: null, memberIds };
}

function data(overrides: Partial<SquadPlayersData> = {}): SquadPlayersData {
  return {
    profiles: [],
    openProposals: [],
    liveSquads: [],
    pendingRequests: [],
    cooldownPairs: {},
    members: {},
    missingMemberIds: [],
    unresolvedMemberIds: [],
    membersError: null,
    ...overrides,
  };
}

/** O bit de uma célula na grade de 28 posições. */
const bitOf = (cell: SquadCell) => Math.log2(toBits([cell]));

function rowOf(rows: readonly PlayerRow[], userId: string): PlayerRow {
  const row = rows.find((entry) => entry.userId === userId);
  if (!row) throw new Error(`linha de ${userId} não existe`);
  return row;
}

describe('buildPlayerRows', () => {
  it('usa o nome do servidor, cai para o ID sem ele e diz quem saiu', () => {
    const rows = buildPlayerRows(
      data({
        profiles: [profile(ANA), profile(DAN), profile(EVA), profile(BIA, { gameId: OTHER_GAME })],
        members: {
          [ANA]: { displayName: 'Ana', username: 'ana', avatarUrl: 'https://cdn.discordapp.com/a.png' },
        },
        missingMemberIds: [DAN],
      }),
      GAME,
    );

    expect(rows.map((row) => [row.userId, row.name, row.username, row.inGuild])).toEqual([
      [ANA, 'Ana', 'ana', true],
      [DAN, DAN, null, false],
      // O bot não conseguiu conferir: presença desconhecida, não "saiu".
      [EVA, EVA, null, null],
    ]);
    expect(rowOf(rows, ANA).avatarUrl).toBe('https://cdn.discordapp.com/a.png');
  });

  it('marca squad, proposta e pedido só deste jogo, mas conta squads de todos os jogos', () => {
    const rows = buildPlayerRows(
      data({
        profiles: [
          profile(ANA),
          profile(BIA, { status: 'in_squad' }),
          profile(CAU, { status: 'paused' }),
        ],
        liveSquads: [squad(ALFA, GAME, [BIA]), squad(BRAVO, OTHER_GAME, [ANA, BIA])],
        openProposals: [
          // Ana passou: não está mais ocupada por esta proposta.
          proposal('p1', { userIds: [ANA, CAU], declinedIds: [ANA] }),
          proposal('p2', { gameId: OTHER_GAME, userIds: [CAU] }),
        ],
        pendingRequests: [
          { id: 'r1', squadId: ALFA, userId: CAU, createdAt: '2026-09-12T12:00:00.000Z' },
          { id: 'r2', squadId: BRAVO, userId: CAU, createdAt: '2026-09-12T12:00:00.000Z' },
        ],
      }),
      GAME,
    );

    expect(rowOf(rows, ANA)).toMatchObject({
      squadIds: [],
      activeSquadCount: 1,
      openProposalIds: [],
      inSquadInGame: false,
    });
    expect(rowOf(rows, BIA)).toMatchObject({
      squadIds: [ALFA],
      activeSquadCount: 2,
      inSquadInGame: true,
    });
    expect(rowOf(rows, CAU)).toMatchObject({
      openProposalIds: ['p1'],
      pendingRequestSquadIds: [ALFA],
      activeSquadCount: 0,
      inSquadInGame: false,
    });
  });

  it('perfil in_squad sem squad vivo também fica fora do match manual', () => {
    const [row] = buildPlayerRows(data({ profiles: [profile(ANA, { status: 'in_squad' })] }), GAME);

    expect(row).toMatchObject({ squadIds: [], inSquadInGame: true });
  });
});

describe('summarizePlayers', () => {
  const rows: Pick<PlayerRow, 'status' | 'availability' | 'answers'>[] = [
    {
      status: 'searching',
      availability: toBits([SAT_NIGHT, SUN_MORNING]),
      answers: { plataforma: 'PC', frente: ['Bots', 'Bugs'], nick: 'ana' },
    },
    // Opção repetida conta uma vez.
    { status: 'searching', availability: toBits([SAT_NIGHT]), answers: { plataforma: 'PC', frente: ['Bots', 'Bots'] } },
    { status: 'paused', availability: toBits([SAT_NIGHT]), answers: { plataforma: 'PS5', nick: '  ' } },
    // Resposta fora das opções atuais: respondeu, mas não vira barra.
    { status: 'in_squad', availability: 0, answers: { plataforma: 'Xbox' } },
  ];

  it('conta status, opções, quem não respondeu e a grade', () => {
    const summary = summarizePlayers(FIELDS, rows);

    expect(summary.total).toBe(4);
    expect(summary.scoped).toBe(4);
    expect(summary.byStatus).toEqual({ searching: 2, in_squad: 1, paused: 1 });
    expect(summary.answers).toEqual([
      {
        key: 'plataforma',
        label: 'Plataforma',
        match: 'hard',
        type: 'select',
        options: [
          { option: 'PC', count: 2 },
          { option: 'PS5', count: 1 },
        ],
        answered: 4,
        unanswered: 0,
      },
      {
        key: 'frente',
        label: 'Frente',
        match: 'soft',
        type: 'tags',
        options: [
          { option: 'Bots', count: 2 },
          { option: 'Bugs', count: 1 },
        ],
        answered: 2,
        unanswered: 2,
      },
      // Texto livre só conta quem respondeu; em branco não é resposta.
      { key: 'nick', label: 'Nick', match: 'none', type: 'text', options: [], answered: 1, unanswered: 3 },
    ]);
    expect(summary.grid).toHaveLength(28);
    expect(summary.grid[bitOf(SAT_NIGHT)]).toBe(3);
    expect(summary.grid[bitOf(SUN_MORNING)]).toBe(1);
    expect(summary.grid.reduce((sum, count) => sum + count, 0)).toBe(4);
  });

  it('o filtro de status vale para respostas e grade, não para o total e os status', () => {
    const summary = summarizePlayers(FIELDS, rows, ['paused']);

    expect(summary.total).toBe(4);
    expect(summary.byStatus).toEqual({ searching: 2, in_squad: 1, paused: 1 });
    expect(summary.scoped).toBe(1);
    expect(summary.answers[0]?.options).toEqual([
      { option: 'PC', count: 0 },
      { option: 'PS5', count: 1 },
    ]);
    expect(summary.answers[2]).toMatchObject({ answered: 0, unanswered: 1 });
    expect(summary.grid[bitOf(SAT_NIGHT)]).toBe(1);
    expect(summary.grid[bitOf(SUN_MORNING)]).toBe(0);
  });
});

describe('selectionNotes', () => {
  const rows = buildPlayerRows(
    data({
      profiles: [
        profile(ANA, { answers: { plataforma: 'PC', frente: ['Bots'] } }),
        profile(BIA, { answers: { plataforma: 'PS5', frente: ['Bots'] } }),
        profile(CAU, {
          status: 'paused',
          availability: toBits([SUN_MORNING]),
          answers: { plataforma: 'PC' },
        }),
      ],
    }),
    GAME,
  );

  it('sem ninguém marcado não há nota', () => {
    expect(selectionNotes(FIELDS, rows, new Set(), new Set()).size).toBe(0);
  });

  it('marca conflito, horário, cooldown e pausa contra quem está marcado', () => {
    const notes = selectionNotes(FIELDS, rows, new Set([ANA]), new Set([pairKey(BIA, ANA)]));

    expect(notes.has(ANA)).toBe(false);
    expect(notes.get(BIA)).toEqual({
      score: scoreProfiles(FIELDS, rowOf(rows, BIA), rowOf(rows, ANA)).score,
      hardConflict: true,
      noCommonCell: false,
      cooldown: true,
      paused: false,
    });
    expect(notes.get(CAU)).toEqual({
      score: scoreProfiles(FIELDS, rowOf(rows, CAU), rowOf(rows, ANA)).score,
      hardConflict: false,
      noCommonCell: true,
      cooldown: false,
      paused: true,
    });
  });

  it('a nota soma as duplas contra cada selecionado', () => {
    const notes = selectionNotes(FIELDS, rows, new Set([ANA, BIA]), new Set());
    const cau = rowOf(rows, CAU);

    expect(notes.get(CAU)?.score).toBe(
      scoreProfiles(FIELDS, cau, rowOf(rows, ANA)).score +
        scoreProfiles(FIELDS, cau, rowOf(rows, BIA)).score,
    );
    // Um conflito com qualquer selecionado basta.
    expect(notes.get(CAU)?.hardConflict).toBe(true);
  });
});
