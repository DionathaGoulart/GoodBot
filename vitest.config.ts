import { defineConfig } from 'vitest/config';

// Um projeto Vitest por pacote do workspace. Cada pacote pode ter o seu
// próprio `vitest.config.ts` para sobrescrever opções (ambiente, setup etc.).
export default defineConfig({
  test: {
    projects: ['packages/shared', 'packages/db', 'apps/bot', 'apps/web'],
    passWithNoTests: true,
  },
});
