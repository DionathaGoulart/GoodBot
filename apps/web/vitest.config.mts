import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    name: 'web',
    // `threads` sobe muito mais rápido que `forks` neste repo (OneDrive +
    // WSL): com `forks` o worker do jsdom estoura o timeout de start de 60s.
    pool: 'threads',
    // `node` por padrão: carregar um DOM custa dezenas de segundos neste repo
    // (OneDrive + WSL) e só os testes de componente precisam dele — esses
    // pedem `@vitest-environment happy-dom` no docblock. O jsdom não serve
    // aqui: só o `require` dele leva ~90s e estoura o timeout de start de 60s
    // do worker do Vitest, que não é configurável.
    environment: 'node',
    // Necessário para o cleanup automático do Testing Library entre os testes.
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', '.next/**'],
  },
});
