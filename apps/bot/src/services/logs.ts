import { getLogConfigs } from '@cobot/db';
import { MAX_EMBED_FIELD_VALUE_LENGTH, MINUTE_MS } from '@cobot/shared';

import { childLogger } from '../logger';

import type { ConfigService } from './config';
import type { LogEntry, LogQueue } from './log-queue';
import type { Db, LogConfigEntry, LogConfigMap } from '@cobot/db';
import type { LogKind } from '@cobot/shared';

const log = childLogger('logs');

/** Por que um log não foi publicado — vira `debug`, nunca erro. */
export type SkipReason =
  'module-disabled' | 'kind-disabled' | 'no-channel' | 'ignored-channel' | 'ignored-role';

export type LogTarget = { channelId: string } | { skipped: SkipReason };

/** Contexto do evento, usado só para aplicar canais/cargos ignorados. */
export interface LogContext {
  /** Canal onde o evento aconteceu (mensagem, voice). */
  channelId?: string | null;
  /** Cargos de quem gerou o evento. */
  roleIds?: readonly string[];
}

export interface ResolveInput {
  config: Pick<LogConfigEntry, 'enabled' | 'channelId' | 'ignoredChannelIds' | 'ignoredRoleIds'>;
  /** `guild_settings.log_channel_id`: herdado quando o tipo não tem canal. */
  fallbackChannelId: string | null;
  context?: LogContext;
}

/**
 * Decide para qual canal um log vai. Pura de propósito: é a regra do PRD §5.4
 * (canal por tipo com fallback no canal geral, mais ignorados) e o teste bate
 * nela direto, sem client nem banco.
 */
export function resolveLogTarget(input: ResolveInput): LogTarget {
  const { config, fallbackChannelId, context } = input;
  if (!config.enabled) return { skipped: 'kind-disabled' };

  const channelId = config.channelId ?? fallbackChannelId;
  if (!channelId) return { skipped: 'no-channel' };

  const origin = context?.channelId;
  if (origin && config.ignoredChannelIds.includes(origin)) {
    return { skipped: 'ignored-channel' };
  }
  // Um canal ignorado não pode ser burlado por um log postado nele mesmo.
  if (origin && origin === channelId) return { skipped: 'ignored-channel' };

  const roleIds = context?.roleIds;
  if (roleIds?.length && config.ignoredRoleIds.some((id) => roleIds.includes(id))) {
    return { skipped: 'ignored-role' };
  }

  return { channelId };
}

// ── formatação ──────────────────────────────────────────────────────────────

/** Corta em `max` (default: limite de um field de embed) com reticências. */
export function truncate(value: string, max = MAX_EMBED_FIELD_VALUE_LENGTH): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

/** Vazio vira um traço: field de embed não aceita string vazia. */
export function fieldValue(value: string | null | undefined, empty = '—'): string {
  const trimmed = value?.trim();
  return trimmed ? truncate(trimmed) : empty;
}

/** Bloco de código com o conteúdo cortado para caber no field (1024). */
export function quoteBlock(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return '—';
  // 8 caracteres da cerca + a reticência do `truncate`.
  return `\`\`\`\n${truncate(trimmed, MAX_EMBED_FIELD_VALUE_LENGTH - 9)}\n\`\`\``;
}

export interface DiffField {
  name: string;
  value: string;
  inline: boolean;
}

/** Par "antes/depois" pronto para `addFields`, cada lado truncado em 1024. */
export function formatDiff(
  before: string | null | undefined,
  after: string | null | undefined,
  labels: { before?: string; after?: string } = {},
): DiffField[] {
  return [
    { name: labels.before ?? 'Antes', value: quoteBlock(before), inline: false },
    { name: labels.after ?? 'Depois', value: quoteBlock(after), inline: false },
  ];
}

/** Diferença entre duas listas de IDs (cargos): o que entrou e o que saiu. */
export function diffIds(
  before: readonly string[],
  after: readonly string[],
): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((id) => !beforeSet.has(id)),
    removed: before.filter((id) => !afterSet.has(id)),
  };
}

// ── serviço ─────────────────────────────────────────────────────────────────

export interface LogServiceDeps {
  db: Db;
  config: ConfigService;
  queue: LogQueue;
  /** TTL do cache de `log_configs` (default 5 min, como o `ConfigService`). */
  ttl?: number;
  now?: () => number;
}

interface CacheEntry {
  value: LogConfigMap;
  expiresAt: number;
}

/**
 * Ponto único de publicação de logs. Todo evento chama `emit`, que resolve o
 * canal (config do tipo → canal geral), aplica os ignorados e entrega à fila.
 * Nenhum evento consulta `log_configs` direto — CLAUDE.md.
 */
export class LogService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly deps: LogServiceDeps;
  private readonly ttl: number;
  private readonly now: () => number;

  constructor(deps: LogServiceDeps) {
    this.deps = deps;
    this.ttl = deps.ttl ?? 5 * MINUTE_MS;
    this.now = deps.now ?? Date.now;
    // A config de log muda pelo painel/comando: o bus já invalida a de módulo.
    this.deps.config.bus.subscribe((guildId) => this.invalidate(guildId));
  }

  /** `log_configs` da guild, do cache ou do banco. */
  async getConfigs(guildId: string): Promise<LogConfigMap> {
    const cached = this.cache.get(guildId);
    if (cached && cached.expiresAt > this.now()) return cached.value;

    const value = await getLogConfigs(this.deps.db, guildId);
    this.cache.set(guildId, { value, expiresAt: this.now() + this.ttl });
    return value;
  }

  invalidate(guildId?: string): void {
    if (guildId) this.cache.delete(guildId);
    else this.cache.clear();
  }

  /** `true` se o módulo `logs` está ligado para a guild. */
  isEnabled(guildId: string): Promise<boolean> {
    return this.deps.config.isEnabled(guildId, 'logs');
  }

  /** Canal de destino de um tipo de log, já com fallback e ignorados. */
  async resolve(guildId: string, kind: LogKind, context?: LogContext): Promise<LogTarget> {
    if (!(await this.isEnabled(guildId))) return { skipped: 'module-disabled' };
    const [configs, settings] = await Promise.all([
      this.getConfigs(guildId),
      this.deps.config.getSettings(guildId),
    ]);
    return resolveLogTarget({
      config: configs[kind],
      fallbackChannelId: settings.logChannelId,
      context,
    });
  }

  /**
   * Publica um log. Nunca lança: um log que falha não pode derrubar o evento
   * (nem a punição) que o gerou.
   */
  async emit(
    guildId: string,
    kind: LogKind,
    entry: LogEntry,
    context?: LogContext,
  ): Promise<boolean> {
    try {
      const target = await this.resolve(guildId, kind, context);
      if ('skipped' in target) {
        log.debug({ guildId, kind, reason: target.skipped }, 'log ignorado');
        return false;
      }
      return this.deps.queue.push(target.channelId, entry);
    } catch (error) {
      log.error({ err: error, guildId, kind }, 'falha ao publicar log');
      return false;
    }
  }
}
