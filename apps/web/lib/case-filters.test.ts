import { describe, expect, it } from 'vitest';

import {
  activeCaseFilterCount,
  auditFiltersToQuery,
  caseFiltersToQuery,
  filterRange,
  parseAuditFilters,
  parseCaseFilters,
  EMPTY_CASE_FILTERS,
} from './case-filters';

describe('parseCaseFilters', () => {
  it('sem parâmetros devolve o filtro vazio', () => {
    expect(parseCaseFilters({})).toEqual(EMPTY_CASE_FILTERS);
  });

  it('aceita lista por vírgula e por repetição, ignorando o que não é tipo', () => {
    expect(parseCaseFilters({ type: 'ban,kick,voar' }).type).toEqual(['ban', 'kick']);
    expect(parseCaseFilters({ type: ['ban', 'warn'] }).type).toEqual(['ban', 'warn']);
  });

  it('descarta id que não é snowflake e data fora do formato', () => {
    expect(parseCaseFilters({ actor: 'eu', target: '100000000000000001' })).toMatchObject({
      actorId: '',
      targetId: '100000000000000001',
    });
    expect(parseCaseFilters({ from: '06/09/2026', to: '2026-09-06' })).toMatchObject({
      from: '',
      to: '2026-09-06',
    });
  });

  it('página inválida cai em 1 e direção só aceita asc', () => {
    expect(parseCaseFilters({ page: '0' }).page).toBe(1);
    expect(parseCaseFilters({ page: '-3' }).page).toBe(1);
    expect(parseCaseFilters({ page: '4' }).page).toBe(4);
    expect(parseCaseFilters({ dir: 'asc' }).direction).toBe('asc');
    expect(parseCaseFilters({ dir: 'qualquer' }).direction).toBe('desc');
  });
});

describe('caseFiltersToQuery', () => {
  it('roundtrip: query → filtros → query devolve a mesma URL', () => {
    const url =
      'type=ban%2Ckick&source=dashboard&target=100000000000000001&from=2026-09-01&q=spam&page=3';
    const filters = parseCaseFilters(Object.fromEntries(new URLSearchParams(url)));
    expect(caseFiltersToQuery(filters).toString()).toBe(url);
  });

  it('omite o que está no padrão', () => {
    expect(caseFiltersToQuery(EMPTY_CASE_FILTERS).toString()).toBe('');
  });
});

describe('activeCaseFilterCount', () => {
  it('conta só os filtros, não a paginação', () => {
    expect(activeCaseFilterCount({ ...EMPTY_CASE_FILTERS, page: 5 })).toBe(0);
    expect(
      activeCaseFilterCount({
        ...EMPTY_CASE_FILTERS,
        type: ['ban'],
        q: 'spam',
        from: '2026-09-01',
      }),
    ).toBe(3);
  });
});

describe('filterRange', () => {
  it('o dia final entra inteiro (fim exclusivo é a meia-noite seguinte)', () => {
    const { from, to } = filterRange({ from: '2026-09-01', to: '2026-09-06' }, 'UTC');
    expect(from?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(to?.toISOString()).toBe('2026-09-07T00:00:00.000Z');
  });

  it('respeita o fuso da guild', () => {
    const { from } = filterRange({ from: '2026-09-01', to: '' }, 'America/Sao_Paulo');
    expect(from?.toISOString()).toBe('2026-09-01T03:00:00.000Z');
  });

  it('sem datas, sem limites', () => {
    expect(filterRange({ from: '', to: '' })).toEqual({});
  });
});

describe('parseAuditFilters', () => {
  it('lê ator, ação e período', () => {
    expect(
      parseAuditFilters({ actor: '100000000000000001', action: 'config.update', page: '2' }),
    ).toEqual({
      actorId: '100000000000000001',
      action: 'config.update',
      source: [],
      from: '',
      to: '',
      q: '',
      page: 2,
    });
  });

  it('lê a origem em lista e descarta o que não é origem', () => {
    expect(parseAuditFilters({ source: 'automod,job' }).source).toEqual(['automod', 'job']);
    // `?source=a&source=b` vale o mesmo que `?source=a,b`.
    expect(parseAuditFilters({ source: ['event', 'dashboard'] }).source).toEqual([
      'dashboard',
      'event',
    ]);
    expect(parseAuditFilters({ source: 'inventada' }).source).toEqual([]);
  });

  it('roundtrip da query', () => {
    const url = 'actor=100000000000000001&action=member.ban&source=automod%2Cjob&q=spam';
    const filters = parseAuditFilters(Object.fromEntries(new URLSearchParams(url)));
    expect(auditFiltersToQuery(filters).toString()).toBe(
      'actor=100000000000000001&action=member.ban&source=automod%2Cjob&q=spam',
    );
  });
});
