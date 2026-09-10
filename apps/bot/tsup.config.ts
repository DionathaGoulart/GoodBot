import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Os pacotes do workspace são consumidos do fonte: precisam entrar no bundle.
  noExternal: [/^@goodbot\//],
  splitting: false,
});
