import { SECOND_MS } from '@goodbot/shared';

import { childLogger } from '../logger';

import type { AuditLogEvent, Guild, GuildAuditLogsEntry, PartialUser, User } from 'discord.js';

const log = childLogger('audit-log');

/** O audit log demora a propagar; 2 s é o teto que o PRD dá para esperar. */
export const AUDIT_LOG_TIMEOUT_MS = 2 * SECOND_MS;
/** Entradas mais velhas que isto não são deste evento. */
export const AUDIT_LOG_MAX_AGE_MS = 10 * SECOND_MS;

export interface AuditLookup<T extends AuditLogEvent> {
  guild: Guild;
  type: T;
  /** Filtra pela entidade afetada (usuário, canal, cargo). */
  targetId?: string;
  timeoutMs?: number;
  maxAgeMs?: number;
  /** Delta esperado; evita atribuir outra alteração recente do mesmo alvo. */
  matches?: (entry: GuildAuditLogsEntry) => boolean;
}

export interface AuditResult {
  /** Pode vir parcial quando o executor não está no cache do client. */
  executor: User | PartialUser | null;
  reason: string | null;
}

const EMPTY: AuditResult = { executor: null, reason: null };
const consumed = new Map<string, number>();

/** Deduplica eventos e consultas concorrentes, com memória limitada. */
export function claimAuditEntry(guildId: string, entryId: string): boolean {
  const now = Date.now();
  for (const [key, at] of consumed) {
    if (now - at > 60 * SECOND_MS) consumed.delete(key);
  }
  const key = `${guildId}:${entryId}`;
  if (consumed.has(key)) return false;
  if (consumed.size >= 10_000) consumed.delete(consumed.keys().next().value!);
  consumed.set(key, now);
  return true;
}

/**
 * Descobre quem causou um evento de gateway (quem mudou o cargo, quem apagou o
 * canal). O Discord não manda isso no evento; só o audit log tem, e ele
 * aparece com atraso — daí o timeout curto e o retorno vazio como caso normal,
 * nunca um erro: o log sai sem o "por: @mod" e pronto.
 */
export async function findAuditEntry<T extends AuditLogEvent>(
  lookup: AuditLookup<T>,
): Promise<AuditResult> {
  const { guild, type, targetId } = lookup;
  if (!guild.members.me?.permissions.has('ViewAuditLog')) return EMPTY;

  const timeoutMs = lookup.timeoutMs ?? AUDIT_LOG_TIMEOUT_MS;
  const maxAgeMs = lookup.maxAgeMs ?? AUDIT_LOG_MAX_AGE_MS;

  try {
    const deadline = Date.now() + timeoutMs;
    do {
      const logs = await withTimeout(
        guild.fetchAuditLogs({ type, limit: 25 }),
        Math.max(1, deadline - Date.now()),
      );
      if (!logs) return EMPTY;
      const candidates = [...logs.entries.values()].filter((candidate) => {
        if (Date.now() - candidate.createdTimestamp > maxAgeMs) return false;
        if (targetId && auditTargetId(candidate) !== targetId) return false;
        return !lookup.matches || lookup.matches(candidate);
      });
      // Ambiguidade não é resolvida escolhendo arbitrariamente um moderador.
      if (candidates.length > 1) return EMPTY;
      const entry = candidates[0];
      if (entry) {
        if (!claimAuditEntry(guild.id, entry.id)) return EMPTY;
        return { executor: entry.executor, reason: entry.reason };
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(250, remaining)));
    } while (Date.now() < deadline);
    return EMPTY;
  } catch (error) {
    log.debug({ err: error, guildId: guild.id, type }, 'falha ao consultar o audit log');
    return EMPTY;
  }
}

/** O alvo pode ser um objeto com `id` ou um id solto, dependendo do evento. */
function auditTargetId(entry: GuildAuditLogsEntry): string | null {
  const target: unknown = entry.target;
  if (!target) return entry.targetId;
  if (typeof target === 'string') return target;
  if (typeof target === 'object' && 'id' in target) {
    return String((target as { id: unknown }).id);
  }
  return entry.targetId;
}

/** Resolve com `null` quando o Discord não responde a tempo. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
    timer.unref();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
