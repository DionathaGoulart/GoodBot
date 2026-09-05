import { describe, expect, it } from 'vitest';

import { VERSION } from './index.js';

describe('@cobot/shared', () => {
  it('exporta VERSION no formato semver', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
