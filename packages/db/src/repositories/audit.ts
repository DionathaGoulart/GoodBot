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
