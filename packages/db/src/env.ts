import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

/** Carrega o `.env` da raiz do monorepo (só para scripts e testes deste pacote). */
export function loadRootEnv(): void {
  const here = fileURLToPath(new URL('.', import.meta.url));
  config({ path: resolve(here, '../../../.env'), quiet: true });
}
