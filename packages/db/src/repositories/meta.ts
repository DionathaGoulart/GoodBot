import { eq, sql } from 'drizzle-orm';

import { meta } from '../schema/misc';

import type { DbExecutor } from '../client';

/** Chaves conhecidas da tabela `meta` (pares chave/valor globais). */
export const META_KEYS = {
  /** Hash SHA-256 do manifesto de slash commands já registrado no Discord. */
  commandsHash: 'commands_hash',
  /**
   * Modo manutenção do painel admin. Fica no banco, e não numa variável do
   * processo, porque um deploy no meio da janela desligaria a manutenção sem
   * ninguém pedir — que é justamente quando ela mais precisa continuar de pé.
   */
  maintenance: 'maintenance',
} as const;

export async function getMeta<T = unknown>(db: DbExecutor, key: string): Promise<T | null> {
  const [row] = await db.select().from(meta).where(eq(meta.key, key)).limit(1);
  return row ? (row.value as T) : null;
}

export async function setMeta(db: DbExecutor, key: string, value: unknown): Promise<void> {
  await db
    .insert(meta)
    .values({ key, value })
    .onConflictDoUpdate({ target: meta.key, set: { value, updatedAt: sql`now()` } });
}

export async function deleteMeta(db: DbExecutor, key: string): Promise<void> {
  await db.delete(meta).where(eq(meta.key, key));
}

/** Hash do manifesto de comandos por guild (`commands_hash:<guildId>`). */
export function commandsHashKey(guildId: string): string {
  return `${META_KEYS.commandsHash}:${guildId}`;
}

export async function getCommandsHash(db: DbExecutor, guildId: string): Promise<string | null> {
  return getMeta<string>(db, commandsHashKey(guildId));
}

export async function setCommandsHash(
  db: DbExecutor,
  guildId: string,
  hash: string,
): Promise<void> {
  await setMeta(db, commandsHashKey(guildId), hash);
}

/** Estado do modo manutenção como ele é guardado em `meta`. */
export interface MaintenanceRecord {
  enabled: boolean;
  message: string | null;
  since: string | null;
  by: string | null;
}

const MAINTENANCE_OFF: MaintenanceRecord = {
  enabled: false,
  message: null,
  since: null,
  by: null,
};

/**
 * Lê a manutenção. Chave ausente (banco novo) e chave corrompida caem no mesmo
 * lugar: **desligada**. O contrário — um `jsonb` estranho travando o bot para
 * todo mundo — seria a falha ficar mais cara do que o dado que a causou.
 */
export async function getMaintenance(db: DbExecutor): Promise<MaintenanceRecord> {
  const raw = await getMeta<Partial<MaintenanceRecord>>(db, META_KEYS.maintenance);
  if (!raw || typeof raw !== 'object' || typeof raw.enabled !== 'boolean') {
    return MAINTENANCE_OFF;
  }
  return {
    enabled: raw.enabled,
    message: typeof raw.message === 'string' ? raw.message : null,
    since: typeof raw.since === 'string' ? raw.since : null,
    by: typeof raw.by === 'string' ? raw.by : null,
  };
}

export async function setMaintenance(
  db: DbExecutor,
  record: MaintenanceRecord,
): Promise<MaintenanceRecord> {
  await setMeta(db, META_KEYS.maintenance, record);
  return record;
}
