import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { VERSION } from './index';

describe('VERSION', () => {
  it('é a mesma versão do package.json da raiz', () => {
    const raiz = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as { version: string };

    expect(VERSION).toBe(raiz.version);
  });
});
