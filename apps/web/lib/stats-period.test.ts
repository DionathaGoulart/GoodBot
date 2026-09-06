import { describe, expect, it } from 'vitest';

import {
  fillDays,
  fillDaysByKey,
  formatDayLabel,
  listDays,
  parseRange,
  percentDelta,
  previousPeriod,
  rankKeys,
  zonedDay,
  zonedDayStart,
} from './stats-period';

const TZ = 'America/Sao_Paulo'; // UTC−3, sem horário de verão desde 2019
// 06/09/2026 às 10:00 em São Paulo.
const NOW = new Date('2026-09-06T13:00:00.000Z');

describe('zonedDay / zonedDayStart', () => {
  it('usa o dia da guild, não o dia UTC', () => {
    // 23:30 em SP ainda é dia 6; em UTC já virou dia 7.
    expect(zonedDay(new Date('2026-09-07T02:30:00.000Z'), TZ)).toBe('2026-09-06');
  });

  it('a meia-noite local é 03:00 UTC', () => {
    expect(zonedDayStart('2026-09-06', TZ).toISOString()).toBe('2026-09-06T03:00:00.000Z');
  });

  it('em UTC a meia-noite local é a meia-noite UTC', () => {
    expect(zonedDayStart('2026-09-06', 'UTC').toISOString()).toBe('2026-09-06T00:00:00.000Z');
  });
});

describe('parseRange', () => {
  it('sem parâmetro cai em 30d', () => {
    const period = parseRange(undefined, { now: NOW, timezone: TZ });
    expect(period.preset).toBe('30d');
    expect(period.days).toBe(30);
    expect(period.value).toBe('30d');
  });

  it('inclui o dia de hoje no fim da janela', () => {
    const period = parseRange('7d', { now: NOW, timezone: TZ });
    expect(period.days).toBe(7);
    expect(zonedDay(period.from, TZ)).toBe('2026-08-31');
    // `to` é exclusivo: a meia-noite do dia seguinte a hoje.
    expect(period.to.toISOString()).toBe('2026-09-07T03:00:00.000Z');
  });

  it('aceita intervalo custom com extremos inclusivos', () => {
    const period = parseRange('2026-09-01,2026-09-03', { now: NOW, timezone: TZ });
    expect(period.preset).toBeNull();
    expect(period.days).toBe(3);
    expect(listDays(period)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
  });

  it('ignora lixo, datas invertidas, datas impossíveis e janelas acima da retenção', () => {
    for (const raw of ['banana', '2026-09-10,2026-09-01', '2026-02-31,2026-03-01', '', '7']) {
      expect(parseRange(raw, { now: NOW, timezone: TZ }).preset).toBe('30d');
    }
    expect(parseRange('2026-01-01,2026-09-06', { now: NOW, timezone: TZ }).preset).toBe('30d');
  });

  it('usa o primeiro valor quando o searchParam vem repetido', () => {
    expect(parseRange(['7d', '90d'], { now: NOW, timezone: TZ }).preset).toBe('7d');
  });
});

describe('previousPeriod', () => {
  it('é a janela imediatamente anterior, do mesmo tamanho', () => {
    const period = parseRange('7d', { now: NOW, timezone: TZ });
    const before = previousPeriod(period);
    expect(before.to).toEqual(period.from);
    expect(before.to.getTime() - before.from.getTime()).toBe(
      period.to.getTime() - period.from.getTime(),
    );
    expect(zonedDay(before.from, TZ)).toBe('2026-08-24');
  });
});

describe('fillDays', () => {
  it('preenche com zero os dias sem bucket e mantém a ordem', () => {
    const period = parseRange('2026-09-01,2026-09-04', { now: NOW, timezone: TZ });
    expect(fillDays([{ date: '2026-09-03', count: 12 }], period)).toEqual([
      { date: '2026-09-01', count: 0 },
      { date: '2026-09-02', count: 0 },
      { date: '2026-09-03', count: 12 },
      { date: '2026-09-04', count: 0 },
    ]);
  });

  it('descarta dias fora do período', () => {
    const period = parseRange('2026-09-01,2026-09-02', { now: NOW, timezone: TZ });
    const series = fillDays([{ date: '2026-08-30', count: 99 }], period);
    expect(series).toHaveLength(2);
    expect(series.every((point) => point.count === 0)).toBe(true);
  });
});

describe('fillDaysByKey', () => {
  it('dá um valor a toda chave em todo dia', () => {
    const period = parseRange('2026-09-01,2026-09-02', { now: NOW, timezone: TZ });
    expect(
      fillDaysByKey([{ date: '2026-09-02', key: 'ban', count: 3 }], period, ['ban', 'warn']),
    ).toEqual([
      { date: '2026-09-01', ban: 0, warn: 0 },
      { date: '2026-09-02', ban: 3, warn: 0 },
    ]);
  });
});

describe('percentDelta', () => {
  it('calcula a variação sobre o período anterior', () => {
    expect(percentDelta(150, 100)).toBe(50);
    expect(percentDelta(50, 100)).toBe(-50);
    expect(percentDelta(100, 100)).toBe(0);
  });

  it('sem base de comparação não inventa porcentagem', () => {
    expect(percentDelta(10, 0)).toBeNull();
    expect(percentDelta(0, 0)).toBeNull();
  });
});

describe('rankKeys', () => {
  it('ordena por total e corta no limite', () => {
    const points = [
      { key: 'warn', count: 2 },
      { key: 'ban', count: 5 },
      { key: 'warn', count: 4 },
      { key: 'kick', count: 1 },
    ];
    expect(rankKeys(points, 2)).toEqual(['warn', 'ban']);
  });
});

describe('formatDayLabel', () => {
  it('encurta para dia/mês', () => {
    expect(formatDayLabel('2026-09-06')).toBe('06/09');
  });
});
