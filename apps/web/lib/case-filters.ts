import {
  AUDIT_SOURCES,
  CASE_SOURCES,
  CASE_TYPES,
  type AuditSource,
  type CaseSource,
  type CaseType,
} from '@goodbot/shared';

import { addDays, zonedDayStart, DEFAULT_TIMEZONE } from './stats-period';

/**
 * O estado das páginas de casos e auditoria mora na URL (PRD §6.4): o filtro
 * é compartilhável e o botão "voltar" funciona. Este módulo é puro nos dois
 * sentidos — sem `server-only`, porque a toolbar do cliente monta a mesma
 * query string que o server component leu.
 */

/** Quantas linhas por página nas duas tabelas. */
export const PAGE_SIZE = 25;

/** Teto do export (PRD §6.4); acima disso o CSV pede filtro mais estreito. */
export const EXPORT_LIMIT = 10_000;

export const CASE_SORTS = ['createdAt', 'caseNumber'] as const;
export type CaseSort = (typeof CASE_SORTS)[number];

/** O que a URL de `/casos` carrega. Campos vazios não entram na query. */
export interface CaseFilters {
  type: CaseType[];
  source: CaseSource[];
  actorId: string;
  targetId: string;
  /** `AAAA-MM-DD` no fuso da guild; vazio = sem limite. */
  from: string;
  to: string;
  q: string;
  page: number;
  sort: CaseSort;
  direction: 'asc' | 'desc';
}

export const EMPTY_CASE_FILTERS: CaseFilters = {
  type: [],
  source: [],
  actorId: '',
  targetId: '',
  from: '',
  to: '',
  q: '',
  page: 1,
  sort: 'createdAt',
  direction: 'desc',
};

/** O que o `searchParams` de um server component entrega. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value.trim() : '';
}

/** `?type=ban,kick` e `?type=ban&type=kick` valem a mesma coisa. */
function list<T extends string>(raw: string | string[] | undefined, allowed: readonly T[]): T[] {
  const values = (Array.isArray(raw) ? raw : [raw ?? ''])
    .flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : []))
    .map((entry) => entry.trim());
  return allowed.filter((option) => values.includes(option));
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function day(raw: string | string[] | undefined): string {
  const value = first(raw);
  return DAY_PATTERN.test(value) ? value : '';
}

function snowflake(raw: string | string[] | undefined): string {
  const value = first(raw);
  return /^\d{17,20}$/.test(value) ? value : '';
}

function page(raw: string | string[] | undefined): number {
  const value = Number(first(raw));
  return Number.isInteger(value) && value > 0 ? value : 1;
}

/** URL → filtros. Nada aqui lança: parâmetro inválido some, não vira erro. */
export function parseCaseFilters(params: RawSearchParams): CaseFilters {
  const sort = first(params.sort);
  const direction = first(params.dir);
  return {
    type: list(params.type, CASE_TYPES),
    source: list(params.source, CASE_SOURCES),
    actorId: snowflake(params.actor),
    targetId: snowflake(params.target),
    from: day(params.from),
    to: day(params.to),
    q: first(params.q).slice(0, 200),
    page: page(params.page),
    sort: (CASE_SORTS as readonly string[]).includes(sort) ? (sort as CaseSort) : 'createdAt',
    direction: direction === 'asc' ? 'asc' : 'desc',
  };
}

/** Filtros → query string canônica (a mesma URL para o mesmo filtro). */
export function caseFiltersToQuery(filters: CaseFilters): URLSearchParams {
  const query = new URLSearchParams();
  if (filters.type.length) query.set('type', filters.type.join(','));
  if (filters.source.length) query.set('source', filters.source.join(','));
  if (filters.actorId) query.set('actor', filters.actorId);
  if (filters.targetId) query.set('target', filters.targetId);
  if (filters.from) query.set('from', filters.from);
  if (filters.to) query.set('to', filters.to);
  if (filters.q) query.set('q', filters.q);
  if (filters.page > 1) query.set('page', String(filters.page));
  if (filters.sort !== 'createdAt') query.set('sort', filters.sort);
  if (filters.direction !== 'desc') query.set('dir', filters.direction);
  return query;
}

/** Quantos filtros (fora paginação e ordenação) estão ativos. */
export function activeCaseFilterCount(filters: CaseFilters): number {
  return [
    filters.type.length > 0,
    filters.source.length > 0,
    Boolean(filters.actorId),
    Boolean(filters.targetId),
    Boolean(filters.from),
    Boolean(filters.to),
    Boolean(filters.q),
  ].filter(Boolean).length;
}

/**
 * `AAAA-MM-DD` → janela `[from, to)` em instantes reais. `to` inclui o dia
 * inteiro: quem filtra "até 06/09" espera ver o caso das 23h daquele dia.
 */
export function filterRange(
  filters: Pick<CaseFilters, 'from' | 'to'>,
  timezone = DEFAULT_TIMEZONE,
): { from?: Date; to?: Date } {
  return {
    ...(filters.from ? { from: zonedDayStart(filters.from, timezone) } : {}),
    ...(filters.to ? { to: zonedDayStart(addDays(filters.to, 1), timezone) } : {}),
  };
}

// ── auditoria ───────────────────────────────────────────────────────────────

export interface AuditFilters {
  actorId: string;
  action: string;
  /** Origens marcadas; vazio = todas (Etapa 22). */
  source: AuditSource[];
  from: string;
  to: string;
  q: string;
  page: number;
}

export const EMPTY_AUDIT_FILTERS: AuditFilters = {
  actorId: '',
  action: '',
  source: [],
  from: '',
  to: '',
  q: '',
  page: 1,
};

export function parseAuditFilters(params: RawSearchParams): AuditFilters {
  return {
    actorId: snowflake(params.actor),
    // A ação é texto livre porque a lista cresce a cada módulo novo.
    action: first(params.action).slice(0, 64),
    source: list(params.source, AUDIT_SOURCES),
    from: day(params.from),
    to: day(params.to),
    q: first(params.q).slice(0, 200),
    page: page(params.page),
  };
}

export function auditFiltersToQuery(filters: AuditFilters): URLSearchParams {
  const query = new URLSearchParams();
  if (filters.actorId) query.set('actor', filters.actorId);
  if (filters.action) query.set('action', filters.action);
  if (filters.source.length) query.set('source', filters.source.join(','));
  if (filters.from) query.set('from', filters.from);
  if (filters.to) query.set('to', filters.to);
  if (filters.q) query.set('q', filters.q);
  if (filters.page > 1) query.set('page', String(filters.page));
  return query;
}

export function activeAuditFilterCount(filters: AuditFilters): number {
  return [
    Boolean(filters.actorId),
    Boolean(filters.action),
    filters.source.length > 0,
    Boolean(filters.from),
    Boolean(filters.to),
    Boolean(filters.q),
  ].filter(Boolean).length;
}
