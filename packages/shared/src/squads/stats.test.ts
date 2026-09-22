import { describe, expect, it } from 'vitest';

import { MINUTE_MS } from '../constants';
import {
  formationSegments,
  formationSize,
  mergeIntervals,
  pairOverlapMs,
  presenceMs,
  summarizeFormations,
  summarizePairs,
  summarizePlayers,
  summarizeSession,
  type SquadAttendanceRow,
  type SquadStatsSession,
} from './stats';

/** Sexta, 18/09/2026, 21h em São Paulo: o minuto zero das jogatinas dos testes. */
const T0 = Date.parse('2026-09-19T00:00:00Z');
const at = (minute: number) => new Date(T0 + minute * MINUTE_MS);
const min = (count: number) => count * MINUTE_MS;

const A = '300000000000000001';
const B = '300000000000000002';
const C = '300000000000000003';
const D = '300000000000000004';
const G = '300000000000000009';

/** Entrada de `from` a `to` minutos depois de T0; `to` nulo é quem ainda está. */
function row(
  sessionId: number,
  userId: string,
  from: number,
  to: number | null,
  asGuest = false,
): SquadAttendanceRow {
  return { sessionId, userId, joinedAt: at(from), leftAt: to === null ? null : at(to), asGuest };
}

const session = (
  id: number,
  goingIds: string[],
  playedAt: Date | null = at(0),
): SquadStatsSession => ({ id, goingIds, playedAt });

const OPTIONS = { now: at(600), partySize: 4 };

describe('mergeIntervals', () => {
  it.each([
    { name: 'vazio', input: [], output: [] },
    {
      name: 'sobreposição e encosto viram um',
      input: [
        { start: 10, end: 20 },
        { start: 0, end: 12 },
        { start: 20, end: 25 },
      ],
      output: [{ start: 0, end: 25 }],
    },
    {
      name: 'buraco separa',
      input: [
        { start: 30, end: 40 },
        { start: 0, end: 10 },
      ],
      output: [
        { start: 0, end: 10 },
        { start: 30, end: 40 },
      ],
    },
    {
      name: 'vazio ou invertido some',
      input: [
        { start: 5, end: 5 },
        { start: 9, end: 3 },
        { start: 1, end: 2 },
      ],
      output: [{ start: 1, end: 2 }],
    },
    {
      name: 'contido some dentro do maior',
      input: [
        { start: 0, end: 100 },
        { start: 10, end: 20 },
      ],
      output: [{ start: 0, end: 100 }],
    },
  ])('$name', ({ input, output }) => {
    expect(mergeIntervals(input)).toEqual(output);
  });

  it('não altera a entrada', () => {
    const input = [
      { start: 0, end: 10 },
      { start: 5, end: 20 },
    ];
    mergeIntervals(input);
    expect(input).toEqual([
      { start: 0, end: 10 },
      { start: 5, end: 20 },
    ]);
  });
});

describe('presenceMs', () => {
  it.each([
    { name: 'uma entrada', rows: [row(1, A, 0, 90)], ms: min(90) },
    { name: 'saiu e voltou', rows: [row(1, A, 0, 30), row(1, A, 40, 100)], ms: min(90) },
    {
      name: 'linhas duplicadas (evento e varredura) não contam duas vezes',
      rows: [row(1, A, 0, 60), row(1, A, 10, 60)],
      ms: min(60),
    },
    { name: 'aberta conta até agora', rows: [row(1, A, 500, null)], ms: min(100) },
    {
      name: 'jogatinas diferentes somam',
      rows: [row(1, A, 0, 60), row(2, A, 0, 30)],
      ms: min(90),
    },
    { name: 'saída antes da entrada não conta', rows: [row(1, A, 50, 40)], ms: 0 },
  ])('$name', ({ rows, ms }) => {
    expect(presenceMs(rows, OPTIONS.now)).toBe(ms);
  });
});

describe('formationSegments', () => {
  it('corta a linha do tempo a cada entrada e saída', () => {
    // A: 0-120, B: 30-120, C: 60-90, D: 100-130.
    const segments = formationSegments(
      [row(1, A, 0, 120), row(1, B, 30, 120), row(1, C, 60, 90), row(1, D, 100, 130)],
      OPTIONS.now,
    );
    expect(segments.map(({ userIds, ms }) => ({ userIds, ms }))).toEqual([
      { userIds: [A], ms: min(30) },
      { userIds: [A, B], ms: min(30) },
      { userIds: [A, B, C], ms: min(30) },
      { userIds: [A, B], ms: min(10) },
      { userIds: [A, B, D], ms: min(20) },
      { userIds: [D], ms: min(10) },
    ]);
    expect(segments[0]).toMatchObject({ start: at(0), end: at(30) });
  });

  it('voice vazio no meio fica de fora, e a volta é outro trecho', () => {
    const segments = formationSegments([row(1, A, 0, 30), row(1, A, 50, 60)], OPTIONS.now);
    expect(segments.map(({ start, end }) => [start, end])).toEqual([
      [at(0), at(30)],
      [at(50), at(60)],
    ]);
  });

  it('entrada duplicada da mesma pessoa não cria trecho novo', () => {
    const segments = formationSegments(
      [row(1, A, 0, 60), row(1, A, 20, 60), row(1, B, 0, 60)],
      OPTIONS.now,
    );
    expect(segments).toEqual([{ userIds: [A, B], start: at(0), end: at(60), ms: min(60) }]);
  });

  it('convidado conta na formação', () => {
    const segments = formationSegments([row(1, A, 0, 60), row(1, G, 0, 60, true)], OPTIONS.now);
    expect(segments.map((segment) => segment.userIds)).toEqual([[A, G]]);
  });

  it('sem linhas, sem trechos', () => {
    expect(formationSegments([], OPTIONS.now)).toEqual([]);
  });
});

describe('formationSize', () => {
  it.each([
    { size: 1, party: 4, label: 'solo', mark: 'partial' },
    { size: 2, party: 4, label: 'dupla', mark: 'partial' },
    { size: 3, party: 4, label: 'trio', mark: 'partial' },
    { size: 4, party: 4, label: 'quarteto', mark: 'full' },
    { size: 5, party: 4, label: 'grupo de 5', mark: 'over' },
    { size: 2, party: 2, label: 'dupla', mark: 'full' },
    { size: 3, party: 2, label: 'trio', mark: 'over' },
    { size: 8, party: 10, label: 'grupo de 8', mark: 'partial' },
  ])('$size com party de $party: $label, $mark', ({ size, party, label, mark }) => {
    expect(formationSize(size, party)).toEqual({ size, label, party: mark });
  });
});

describe('summarizeFormations', () => {
  const rows = [
    // Jogatina 1: A solo 10 min, A+B 20 min, A+B+C+D 60 min.
    row(1, A, 0, 90),
    row(1, B, 10, 90),
    row(1, C, 30, 90),
    row(1, D, 30, 90),
    // Jogatina 2: A+B 40 min, depois A+B+C+D+G (mais que uma party) 20 min.
    row(2, A, 0, 60),
    row(2, B, 0, 60),
    row(2, C, 40, 60),
    row(2, D, 40, 60),
    row(2, G, 40, 60, true),
  ];

  it('soma o tempo por tamanho de grupo, do menor para o maior', () => {
    expect(summarizeFormations(rows, OPTIONS).bySize).toEqual([
      { size: 1, label: 'solo', party: 'partial', ms: min(10) },
      { size: 2, label: 'dupla', party: 'partial', ms: min(60) },
      { size: 4, label: 'quarteto', party: 'full', ms: min(60) },
      { size: 5, label: 'grupo de 5', party: 'over', ms: min(20) },
    ]);
  });

  it('lista os grupos exatos, do que mais jogou junto, sem solo', () => {
    expect(summarizeFormations(rows, OPTIONS).groups).toEqual([
      { userIds: [A, B], ms: min(60) },
      { userIds: [A, B, C, D], ms: min(60) },
      { userIds: [A, B, C, D, G], ms: min(20) },
    ]);
    expect(summarizeFormations(rows, { ...OPTIONS, limit: 1 }).groups).toEqual([
      { userIds: [A, B], ms: min(60) },
    ]);
  });

  it('sem presença, tudo vazio', () => {
    expect(summarizeFormations([], OPTIONS)).toEqual({ bySize: [], groups: [] });
  });
});

describe('pairOverlapMs e summarizePairs', () => {
  const rows = [
    row(1, A, 0, 90),
    row(1, B, 30, 90),
    row(1, C, 60, 120),
    // Mesma faixa de horário, jogatina diferente: não é tempo junto.
    row(2, D, 0, 90),
  ];

  it.each([
    { a: A, b: B, ms: min(60) },
    { a: B, b: A, ms: min(60) },
    { a: A, b: C, ms: min(30) },
    { a: B, b: C, ms: min(30) },
    { a: A, b: D, ms: 0 },
    { a: A, b: A, ms: 0 },
  ])('$a com $b', ({ a, b, ms }) => {
    expect(pairOverlapMs(rows, a, b, OPTIONS.now)).toBe(ms);
  });

  it('ordena as duplas pelo tempo juntos, com ou sem mais gente', () => {
    expect(summarizePairs(rows, { now: OPTIONS.now })).toEqual([
      { userIds: [A, B], ms: min(60) },
      { userIds: [A, C], ms: min(30) },
      { userIds: [B, C], ms: min(30) },
    ]);
    expect(summarizePairs(rows, { now: OPTIONS.now, limit: 1 })).toHaveLength(1);
  });
});

describe('summarizeSession', () => {
  it('duração, quem foi, quem faltou, quem apareceu sem avisar e os convidados', () => {
    const summary = summarizeSession(
      session(1, [A, B, D]),
      [
        row(1, A, 0, 120),
        row(1, B, 10, 40),
        row(1, B, 50, 100),
        row(1, C, 20, 80),
        row(1, G, 30, 130, true),
        row(2, D, 0, 60),
      ],
      OPTIONS,
    );

    expect(summary).toMatchObject({
      sessionId: 1,
      outcome: 'measured',
      firstJoinAt: at(0),
      lastLeaveAt: at(130),
      durationMs: min(130),
      open: false,
    });
    expect(summary.players).toEqual([
      { userId: A, ms: min(120), status: 'attended' },
      { userId: B, ms: min(80), status: 'attended' },
      { userId: C, ms: min(60), status: 'walk_in' },
      { userId: D, ms: 0, status: 'no_show' },
    ]);
    expect(summary.guests).toEqual([{ userId: G, ms: min(100) }]);
    expect(summary.formations.bySize.map((item) => item.size)).toEqual([1, 2, 3, 4]);
  });

  it('com alguém ainda no voice, o fim é agora e provisório', () => {
    const summary = summarizeSession(session(1, [A]), [row(1, A, 540, null)], OPTIONS);
    expect(summary).toMatchObject({
      open: true,
      lastLeaveAt: OPTIONS.now,
      durationMs: min(60),
    });
    expect(summary.players).toEqual([{ userId: A, ms: min(60), status: 'attended' }]);
  });

  it('rolou sem presença medida (sem sala): vale o VOU', () => {
    const summary = summarizeSession(session(1, [A, B]), [], OPTIONS);
    expect(summary).toMatchObject({
      outcome: 'unmeasured',
      firstJoinAt: null,
      lastLeaveAt: null,
      durationMs: 0,
    });
    expect(summary.players).toEqual([
      { userId: A, ms: 0, status: 'attended' },
      { userId: B, ms: 0, status: 'attended' },
    ]);
  });

  it('não rolou: quem disse VOU faltou', () => {
    const summary = summarizeSession(session(1, [A], null), [], OPTIONS);
    expect(summary.outcome).toBe('not_played');
    expect(summary.players).toEqual([{ userId: A, ms: 0, status: 'no_show' }]);
  });

  it('só convidado no voice não faz a jogatina rolar', () => {
    const summary = summarizeSession(session(1, [A], null), [row(1, G, 0, 30, true)], OPTIONS);
    expect(summary.outcome).toBe('not_played');
    expect(summary.guests).toEqual([{ userId: G, ms: min(30) }]);
    expect(summary.durationMs).toBe(min(30));
  });
});

describe('summarizePlayers', () => {
  const sessions = [
    session(1, [A, B]),
    session(2, [A, B, C]),
    session(3, [A, C]), // rolou sem sala
    session(4, [A, B, C], null), // não rolou: fica de fora
  ];
  const rows = [
    // 1: A e B juntos 60 min, depois A solo 30.
    row(1, A, 0, 90),
    row(1, B, 0, 60),
    // 2: A e B juntos 40, C faltou, D apareceu sem avisar 20 min com os dois, G convidado.
    row(2, A, 0, 40),
    row(2, B, 0, 40),
    row(2, D, 20, 40),
    row(2, G, 20, 40, true),
  ];

  it('horas, horas por tamanho, jogatinas, VOU cumpridos, faltas e presença', () => {
    const players = summarizePlayers(sessions, rows, OPTIONS);
    expect(players.map((player) => player.userId)).toEqual([A, B, D, G, C]);

    const [a, b, d, g, c] = players;
    expect(a).toEqual({
      userId: A,
      ms: min(130),
      bySize: [
        { size: 1, label: 'solo', party: 'partial', ms: min(30) },
        { size: 2, label: 'dupla', party: 'partial', ms: min(80) },
        { size: 4, label: 'quarteto', party: 'full', ms: min(20) },
      ],
      sessions: 3,
      going: 3,
      kept: 3,
      noShows: 0,
      walkIns: 0,
      attendanceRate: 1,
    });
    expect(b).toMatchObject({ ms: min(100), sessions: 2, going: 2, kept: 2, noShows: 0 });
    expect(c).toMatchObject({
      ms: 0,
      bySize: [],
      sessions: 1,
      going: 2,
      kept: 1,
      noShows: 1,
      attendanceRate: 0.5,
    });
    expect(d).toMatchObject({
      ms: min(20),
      sessions: 1,
      going: 0,
      walkIns: 1,
      attendanceRate: null,
    });
    expect(g).toMatchObject({ ms: min(20), sessions: 1, going: 0, kept: 0, noShows: 0 });
  });

  it('sem jogatinas, ninguém', () => {
    expect(summarizePlayers([], [], OPTIONS)).toEqual([]);
  });
});
