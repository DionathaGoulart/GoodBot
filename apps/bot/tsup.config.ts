import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  // Pacotes do workspace são fonte TS: entram no bundle. O resto fica em node_modules.
  noExternal: ['@cobot/shared', '@cobot/db'],
});
