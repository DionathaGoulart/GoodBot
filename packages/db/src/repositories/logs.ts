import { LOG_KINDS } from '@goodbot/shared';
import { and, eq, sql } from 'drizzle-orm';

import { logConfigs } from '../schema/configs';
import { guilds } from '../schema/guilds';

import type { DbExecutor } from '../client';
import type { LogConfig } from '../types';
import type { LogKind } from '@goodbot/shared';

/** Uma linha por tipo de log, com defaults para os tipos ainda sem linha. */
export type LogConfigMap = { [K in LogKind]: LogConfigEntry };

export interface LogConfigEntry {
  kind: LogKind;
  enabled: boolean;
  /** `null` = herdar `guild_settings.log_channel_id`. */
  channelId: string | null;
  ignoredChannelIds: string[];
  ignoredRoleIds: string[];
  /** `false` quando não há linha no banco (tudo default). */
  stored: boolean;
}

function defaultEntry(kind: LogKind): LogConfigEntry {
  return {
    kind,
    enabled: false,
    channelId: null,
    ignoredChannelIds: [],
    ignoredRoleIds: [],
    stored: false,
  };
}

function toEntry(row: LogConfig): LogConfigEntry {
  return {
    kind: row.kind,
    enabled: row.enabled,
    channelId: row.channelId,
    ignoredChannelIds: row.ignoredChannelIds,
    ignoredRoleIds: row.ignoredRoleIds,
    stored: true,
  };
}

/** Todos os tipos de log de uma guild numa query só (o bot cacheia o resultado). */
export async function getLogConfigs(db: DbExecutor, guildId: string): Promise<LogConfigMap> {
  const rows = await db.select().from(logConfigs).where(eq(logConfigs.guildId, guildId));
  const byKind = new Map(rows.map((row) => [row.kind, row] as const));
  const entries = LOG_KINDS.map((kind) => {
    const row = byKind.get(kind);
    return [kind, row ? toEntry(row) : defaultEntry(kind)] as const;
  });
  return Object.fromEntries(entries) as LogConfigMap;
}

export type LogConfigInput = Partial<Omit<LogConfigEntry, 'kind' | 'stored'>>;

/**
 * Upsert de um tipo de log. Garante a linha em `guilds` (FK) sem sobrescrever
 * nome/owner, do mesmo jeito que `setModuleConfig`.
 */
export async function setLogConfig(
  db: DbExecutor,
  guildId: string,
  kind: LogKind,
  input: LogConfigInput,
): Promise<void> {
  await db
    .insert(guilds)
    .values({ id: guildId, name: '', ownerId: '' })
    .onConflictDoNothing({ target: guilds.id });

  const values = {
    enabled: input.enabled ?? false,
    channelId: input.channelId ?? null,
    ignoredChannelIds: input.ignoredChannelIds ?? [],
    ignoredRoleIds: input.ignoredRoleIds ?? [],
  };

  // `undefined` no update significa "não mexe"; por isso o set é montado só
  // com as chaves que o chamador realmente passou.
  const patch: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.channelId !== undefined) patch.channelId = input.channelId;
  if (input.ignoredChannelIds !== undefined) patch.ignoredChannelIds = input.ignoredChannelIds;
  if (input.ignoredRoleIds !== undefined) patch.ignoredRoleIds = input.ignoredRoleIds;

  await db
    .insert(logConfigs)
    .values({ guildId, kind, ...values })
    .onConflictDoUpdate({ target: [logConfigs.guildId, logConfigs.kind], set: patch });
}

/** Lê um único tipo (usado por chamadas pontuais; o bot prefere `getLogConfigs`). */
export async function getLogConfig(
  db: DbExecutor,
  guildId: string,
  kind: LogKind,
): Promise<LogConfigEntry> {
  const [row] = await db
    .select()
    .from(logConfigs)
    .where(and(eq(logConfigs.guildId, guildId), eq(logConfigs.kind, kind)))
    .limit(1);
  return row ? toEntry(row) : defaultEntry(kind);
}
