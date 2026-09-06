import { desc, eq } from 'drizzle-orm';

import { auditLogs } from '../schema/audit';

import type { DbExecutor } from '../client';
import type { AuditLog, NewAuditLog } from '../types';

export type AppendAuditInput = Omit<NewAuditLog, 'id' | 'createdAt'>;

/** Registra uma ação do painel. Tabela append-only: não há update/delete. */
export async function appendAudit(db: DbExecutor, input: AppendAuditInput): Promise<AuditLog> {
  const [row] = await db.insert(auditLogs).values(input).returning();
  if (!row) throw new Error('INSERT em audit_logs não retornou linha');
  return row;
}

/**
 * Últimas entradas de auditoria da guild — o bloco "atividade recente" do
 * dashboard (PRD §6.1). A listagem completa com filtros é da Etapa 17.
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
