import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql } from 'drizzle-orm';

import { MAX_CASE_PAGE_SIZE, type SearchResult } from './cases';
import { auditLogs } from '../schema/audit';

import type { DbExecutor } from '../client';
import type { AuditLog, NewAuditLog } from '../types';
import type { AuditSource } from '@cobot/shared';
import type { SQL } from 'drizzle-orm';

export type AppendAuditInput = Omit<NewAuditLog, 'id' | 'createdAt'>;

/**
 * Registra uma ação — do painel ou do próprio bot. Tabela append-only: não há
 * update nem delete.
 */
export async function appendAudit(db: DbExecutor, input: AppendAuditInput): Promise<AuditLog> {
  const [row] = await db.insert(auditLogs).values(input).returning();
  if (!row) throw new Error('INSERT em audit_logs não retornou linha');
  return row;
}

/**
 * Últimas entradas de auditoria da guild — o bloco "atividade recente" do
 * dashboard (PRD §6.1). A listagem completa com filtros é `searchAudit`.
 */
export async function listRecentAudit(
  db: DbExecutor,
  guildId: string,
  limit = 10,
): Promise<AuditLog[]> {
  return db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.guildId, guildId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

/** Filtros da página de auditoria (PRD §6.5). */
export interface AuditSearchFilters {
  guildId: string;
  actorId?: string;
  /** Prefixo ou ação exata: `config`, `config.update`, `member.ban`. */
  action?: string;
  /** Origens aceitas; vazio ou ausente = todas (PRD §6.5). */
  source?: readonly AuditSource[];
  from?: Date;
  /** Instante final **exclusivo**. */
  to?: Date;
  /** Texto livre: ação, tag do ator ou id do alvo. */
  q?: string;
}

export interface AuditSearchOptions extends AuditSearchFilters {
  page?: number;
  pageSize?: number;
  direction?: 'asc' | 'desc';
}

/** Lista de ações distintas já registradas — alimenta o filtro da toolbar. */
export async function listAuditActions(db: DbExecutor, guildId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ action: auditLogs.action })
    .from(auditLogs)
    .where(eq(auditLogs.guildId, guildId))
    .orderBy(asc(auditLogs.action));
  return rows.map((row) => row.action);
}

function auditConditions(filters: AuditSearchFilters): SQL[] {
  const conditions: SQL[] = [eq(auditLogs.guildId, filters.guildId)];
  if (filters.actorId) conditions.push(eq(auditLogs.actorId, filters.actorId));
  if (filters.source?.length) conditions.push(inArray(auditLogs.source, [...filters.source]));
  if (filters.from) conditions.push(gte(auditLogs.createdAt, filters.from));
  if (filters.to) conditions.push(lt(auditLogs.createdAt, filters.to));
  if (filters.action) {
    // `config` casa `config.update` e `config.toggle`: o filtro é por família.
    conditions.push(
      sql`(${auditLogs.action} = ${filters.action} or ${auditLogs.action} like ${`${filters.action}.%`})`,
    );
  }

  const term = filters.q?.trim();
  if (term) {
    const like = `%${term.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
    const combined = or(
      ilike(auditLogs.action, like),
      ilike(auditLogs.actorTag, like),
      ilike(auditLogs.targetId, like),
      ilike(auditLogs.targetType, like),
    );
    if (combined) conditions.push(combined);
  }
  return conditions;
}

/** Busca paginada da auditoria com o total (PRD §6.5). */
export async function searchAudit(
  db: DbExecutor,
  options: AuditSearchOptions,
): Promise<SearchResult<AuditLog>> {
  const page = Math.max(1, Math.trunc(options.page ?? 1));
  const pageSize = Math.min(MAX_CASE_PAGE_SIZE, Math.max(1, Math.trunc(options.pageSize ?? 25)));
  const where = and(...auditConditions(options));
  const order = options.direction === 'asc' ? asc(auditLogs.createdAt) : desc(auditLogs.createdAt);

  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(order, desc(auditLogs.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: sql<number>`count(*)` })
      .from(auditLogs)
      .where(where),
  ]);

  return { rows, total: Number(totalRow?.total ?? 0) };
}
