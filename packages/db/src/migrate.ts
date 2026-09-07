/* eslint-disable no-console -- script de CLI */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { createDb } from './client';
import { loadRootEnv } from './env';

loadRootEnv();

// A CI roda este script contra o Postgres gerenciado (PRD §7.5): a
// `DATABASE_URL` de produção traz `?sslmode=require`, que o postgres-js
// entende sozinho (abre TLS sem exigir CA local). Nada a configurar aqui.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não definida');
  process.exit(1);
}

const here = fileURLToPath(new URL('.', import.meta.url));
const { db, sql } = createDb(url, { max: 1 });
try {
  await migrate(db, { migrationsFolder: resolve(here, '../drizzle') });
  console.log('Migrations aplicadas.');
} finally {
  await sql.end();
}
