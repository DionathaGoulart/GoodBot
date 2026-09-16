import { describe, expect, it } from 'vitest';

import { DEFAULT_SQUAD_BLOCKS } from '../config/squads';
import { DAY_MS } from '../constants';
import {
  EMPTY_SQUAD_HISTORY,
  formatHistory,
  summarizeHistory,
  type SquadHistorySession,
  type SummarizeHistoryInput,
} from './history';

const SAO_PAULO = 'America/Sao_Paulo';
const BLOCKS = DEFAULT_SQUAD_BLOCKS;

/** Segunda-feira, 14/09/2026, 9h em São Paulo. */
const NOW = new Date('2026-09-14T12:00:00Z');

let nextId = 0;
/** Uma jogatina que rolou, com o início em hora de São Paulo (UTC-3). */
function played(localIso: string, goingIds: string[] = []): SquadHistorySession {
  nextId++;
  return { id: nextId, startsAt: new Date(`${localIso}-03:00`), goingIds };
}

function summarize(input: Partial<SummarizeHistoryInput>) {
  return summarizeHistory({
    sessions: [],
    attendance: [],
    now: NOW,
    timeZone: SAO_PAULO,
    blocks: BLOCKS,
    ...input,
  });
}

const format = (input: Partial<SummarizeHistoryInput>, now = NOW) =>
  formatHistory(summarize(input), { now, timeZone: SAO_PAULO, blocks: BLOCKS });

describe('summarizeHistory', () => {
  it('conta as jogatinas, a última e as células no fuso da guild', () => {
    const history = summarize({
      sessions: [
        played('2026-09-11T21:00:00'), // sexta à noite
        played('2026-09-12T21:30:00'), // sábado à noite
        played('2026-09-04T22:00:00'), // sexta à noite
        played('2026-09-05T20:00:00'), // sábado à noite
        played('2026-09-06T15:00:00'), // domingo à tarde
        played('2026-08-01T21:00:00'), // sábado à noite, fora do último mês
      ],
    });
    expect(history.playedLast30d).toBe(5);
    expect(history.playedTotal).toBe(6);
    expect(history.lastPlayedAt?.toISOString()).toBe('2026-09-13T00:30:00.000Z');
    // Sábado à noite tem 3; sexta à noite 2; domingo à tarde 1.
    expect(history.usualCells).toEqual([
      { day: 6, block: 2, count: 3 },
      { day: 5, block: 2, count: 2 },
      { day: 0, block: 1, count: 1 },
    ]);
  });

  it('a madrugada é o começo do próprio dia, e empate de células sai pelo bit', () => {
    const history = summarize({
      sessions: [played('2026-09-12T02:00:00'), played('2026-09-08T10:00:00')],
    });
    // Terça de manhã (bit 8) antes de sábado de madrugada (bit 27).
    expect(history.usualCells).toEqual([
      { day: 2, block: 0, count: 1 },
      { day: 6, block: 3, count: 1 },
    ]);
  });

  it('guarda no máximo três células', () => {
    const history = summarize({
      sessions: [
        played('2026-09-07T10:00:00'),
        played('2026-09-08T10:00:00'),
        played('2026-09-09T10:00:00'),
        played('2026-09-10T10:00:00'),
      ],
    });
    expect(history.usualCells).toHaveLength(3);
  });

  it('hora fora de toda faixa configurada não vira célula, mas a jogatina conta', () => {
    const blocks = BLOCKS.map((block) =>
      block.key === 'evening' ? { ...block, endHour: 22 } : block,
    );
    const history = summarize({ sessions: [played('2026-09-11T23:00:00')], blocks });
    expect(history.playedTotal).toBe(1);
    expect(history.usualCells).toEqual([]);
  });

  it('frequentes saem da presença no voice; sem presença registrada, de quem disse vou', () => {
    const inVoice = played('2026-09-11T21:00:00', ['a', 'b', 'c']);
    const noRoom = played('2026-09-12T21:00:00', ['a', 'c']);
    const history = summarize({
      sessions: [inVoice, noRoom],
      attendance: [
        { sessionId: inVoice.id, userId: 'b' },
        { sessionId: inVoice.id, userId: 'd' },
        // Entrou e saiu duas vezes: conta uma.
        { sessionId: inVoice.id, userId: 'd' },
      ],
    });
    expect(history.regulars).toEqual([
      { userId: 'a', count: 1 },
      { userId: 'b', count: 1 },
      { userId: 'c', count: 1 },
      { userId: 'd', count: 1 },
    ]);
  });

  it('frequentes vão do mais presente ao menos, até cinco', () => {
    const sessions = [
      played('2026-09-11T21:00:00', ['f', 'a', 'b', 'c', 'd', 'e']),
      played('2026-09-12T21:00:00', ['a', 'b']),
      played('2026-09-13T21:00:00', ['b']),
    ];
    expect(summarize({ sessions }).regulars).toEqual([
      { userId: 'b', count: 3 },
      { userId: 'a', count: 2 },
      { userId: 'c', count: 1 },
      { userId: 'd', count: 1 },
      { userId: 'e', count: 1 },
    ]);
  });

  it('os totais cobrem o que ficou fora da janela', () => {
    const lastPlayedAt = new Date(NOW.getTime() - 70 * DAY_MS);
    const history = summarize({ totals: { played: 4, lastPlayedAt } });
    expect(history).toEqual({ ...EMPTY_SQUAD_HISTORY, playedTotal: 4, lastPlayedAt });
  });

  it('nunca conta menos que as jogatinas da janela, mesmo com totais velhos', () => {
    const history = summarize({
      sessions: [played('2026-09-11T21:00:00')],
      totals: { played: 0, lastPlayedAt: null },
    });
    expect(history.playedTotal).toBe(1);
    expect(history.lastPlayedAt).not.toBeNull();
  });
});

describe('formatHistory', () => {
  it('squad que nunca jogou', () => {
    expect(format({})).toBe('Ainda não jogaram.');
  });

  it('agrupa os dias da mesma faixa', () => {
    expect(
      format({
        sessions: [
          played('2026-09-11T21:00:00'),
          played('2026-09-12T21:00:00'),
          played('2026-09-04T21:00:00'),
          played('2026-09-05T21:00:00'),
          played('2026-09-06T15:00:00'),
        ],
      }),
    ).toBe('5 jogatinas no último mês, geralmente sexta e sábado à noite. Última há 2 dias.');
  });

  it('faixas diferentes na ordem da semana, e costume só com duas jogatinas na célula', () => {
    expect(
      format({
        sessions: [
          played('2026-09-11T21:00:00'),
          played('2026-09-04T21:00:00'),
          played('2026-09-06T15:00:00'),
          played('2026-08-30T15:00:00'),
          played('2026-09-09T02:00:00'),
        ],
      }),
    ).toBe(
      '5 jogatinas no último mês, geralmente domingo à tarde e sexta à noite. Última há 3 dias.',
    );
  });

  it('manhã e madrugada levam "de"', () => {
    expect(
      format({
        sessions: [
          played('2026-09-12T02:00:00'),
          played('2026-09-05T03:00:00'),
          played('2026-09-13T09:00:00'),
          played('2026-09-06T10:00:00'),
        ],
      }),
    ).toBe(
      '4 jogatinas no último mês, geralmente domingo de manhã e sábado de madrugada. Última ontem.',
    );
  });

  it('uma jogatina só, hoje', () => {
    expect(format({ sessions: [played('2026-09-14T08:00:00')] })).toBe(
      '1 jogatina no último mês. Última hoje.',
    );
  });

  it('sem jogatina no último mês, diz o total', () => {
    const lastPlayedAt = new Date(NOW.getTime() - 70 * DAY_MS);
    expect(format({ totals: { played: 4, lastPlayedAt } })).toBe(
      'Nenhuma jogatina no último mês (4 no total). Última há 2 meses.',
    );
  });

  it.each([
    [13, 'há 13 dias'],
    [14, 'há 2 semanas'],
    [59, 'há 8 semanas'],
    [60, 'há 2 meses'],
  ])('%i dias atrás: %s', (days, ago) => {
    const lastPlayedAt = new Date(NOW.getTime() - days * DAY_MS);
    expect(format({ totals: { played: 9, lastPlayedAt } })).toContain(`Última ${ago}.`);
  });
});
