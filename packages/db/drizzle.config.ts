import { resolve } from 'node:path';

import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// `DATABASE_URL` vem do `.env` da raiz do monorepo; o ambiente tem prioridade.
// drizzle-kit executa este arquivo com cwd = packages/db (sem `import.meta`).
config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL não definida (copie .env.example para .env na raiz)');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
