import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Testes de integração compartilham o mesmo Postgres: sem paralelismo.
    fileParallelism: false,
  },
});
