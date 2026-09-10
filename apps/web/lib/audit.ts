import 'server-only';

import { appendAudit, listAuditActions, searchAudit } from '@goodbot/db';
import { headers } from 'next/headers';

import { PAGE_SIZE, filterRange, type AuditFilters } from './case-filters';
import { db } from './db';
import { env } from './env';
import { guildTimezone } from './stats';

import type { AuditSource } from '@goodbot/shared';

export interface AuditActor {
  id: string;
  tag: string;
}

/**
 * Registra uma ação do painel (PRD §6.5). A tabela é append-only: nunca
 * editar, nunca apagar. Chame **depois** da escrita dar certo.
 *
 * Origem sempre `dashboard`: desde a Etapa 22 a mesma tabela recebe também o
 * que o bot faz sozinho, e é o `source` que separa as duas histórias. Só o
 * painel tem request, então IP e user-agent só existem nestas linhas.
 */
export async function withAudit(
  actor: AuditActor,
  action: string,
  target: { type?: string; id?: string } = {},
  before?: unknown,
  after?: unknown,
): Promise<void> {
  const requestHeaders = await headers();
  // `x-forwarded-for` é uma lista; o primeiro é o cliente.
  const forwarded = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim();

  await appendAudit(db(), {
    guildId: env().GUILD_ID,
    actorId: actor.id,
    actorTag: actor.tag,
    action,
    source: 'dashboard',
    targetType: target.type ?? null,
    targetId: target.id ?? null,
    before: before ?? null,
    after: after ?? null,
    ip: forwarded ?? requestHeaders.get('x-real-ip'),
    userAgent: requestHeaders.get('user-agent'),
  });
}

/** Uma linha da auditoria como a tabela recebe (datas em texto). */
export interface AuditRow extends Record<string, unknown> {
  id: number;
  actorId: string;
  actorTag: string;
  action: string;
  source: AuditSource;
  reason: string | null;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditPage {
  rows: AuditRow[];
  total: number;
  pageCount: number;
  /** Ações já registradas nesta guild, para o filtro da toolbar. */
  actions: string[];
}

/** Página da auditoria (PRD §6.5) — filtro e paginação no Postgres. */
export async function loadAuditPage(guildId: string, filters: AuditFilters): Promise<AuditPage> {
  const timezone = await guildTimezone(guildId);
  const [{ rows, total }, actions] = await Promise.all([
    searchAudit(db(), {
      guildId,
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.source.length ? { source: filters.source } : {}),
      ...filterRange(filters, timezone),
      ...(filters.q ? { q: filters.q } : {}),
      page: filters.page,
      pageSize: PAGE_SIZE,
    }),
    listAuditActions(db(), guildId),
  ]);

  return {
    total,
    actions,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    rows: rows.map((entry) => ({
      id: entry.id,
      actorId: entry.actorId,
      actorTag: entry.actorTag,
      action: entry.action,
      source: entry.source,
      reason: entry.reason,
      targetType: entry.targetType,
      targetId: entry.targetId,
      before: entry.before,
      after: entry.after,
      ip: entry.ip,
      userAgent: entry.userAgent,
      createdAt: entry.createdAt.toISOString(),
    })),
  };
}
