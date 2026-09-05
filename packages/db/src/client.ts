import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index';

export interface CreateDbOptions {
  /** Conexões no pool (ARM free tier: manter baixo). */
  max?: number;
  /** Segundos ociosos antes de fechar a conexão. */
  idleTimeout?: number;
  /** Segundos para estabelecer conexão. */
  connectTimeout?: number;
}

/** Cria o client Drizzle sobre `postgres` (postgres-js). */
export function createDb(url: string, options: CreateDbOptions = {}) {
  const sql = postgres(url, {
    max: options.max ?? 5,
    idle_timeout: options.idleTimeout ?? 30,
    connect_timeout: options.connectTimeout ?? 10,
    // Snowflakes e contadores viajam como texto/number; sem BigInt implícito.
    transform: { undefined: null },
  });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

export type Db = ReturnType<typeof createDb>['db'];
/** Cliente ou transação: as repositories aceitam ambos. */
export type DbExecutor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
