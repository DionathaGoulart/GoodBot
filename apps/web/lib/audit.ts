import 'server-only';

import { appendAudit } from '@cobot/db';
import { headers } from 'next/headers';

import { db } from './db';
import { env } from './env';

export interface AuditActor {
  id: string;
  tag: string;
}

/**
 * Registra uma ação do painel (PRD §6.5). A tabela é append-only: nunca
 * editar, nunca apagar. Chame **depois** da escrita dar certo.
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
    targetType: target.type ?? null,
    targetId: target.id ?? null,
    before: before ?? null,
    after: after ?? null,
    ip: forwarded ?? requestHeaders.get('x-real-ip'),
    userAgent: requestHeaders.get('user-agent'),
  });
}
