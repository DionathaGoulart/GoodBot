import { MINUTE_MS } from '@cobot/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { RaidService } from './raid';

const GUILD_ID = '900000000000000000';
const CONFIG = { joins: 5, intervalSeconds: 10 };

let clock = 0;
let raid: RaidService;

beforeEach(() => {
  clock = 1_000;
  raid = new RaidService(() => clock);
});

describe('RaidService', () => {
  it('entra em modo raid ao atingir o gatilho', () => {
    for (let i = 0; i < 4; i++) {
      expect(raid.recordJoin(GUILD_ID, CONFIG)).toBe(false);
      clock += 500;
    }
    expect(raid.recordJoin(GUILD_ID, CONFIG)).toBe(true);
  });

  it('não conta entradas fora da janela', () => {
    for (let i = 0; i < 10; i++) {
      expect(raid.recordJoin(GUILD_ID, CONFIG)).toBe(false);
      clock += 11_000;
    }
  });

  it('sai do modo raid quando expira', () => {
    raid.activate({ guildId: GUILD_ID, source: 'auto', minutes: 10 });
    expect(raid.isActive(GUILD_ID)).toBe(true);

    clock += 10 * MINUTE_MS + 1;
    expect(raid.isActive(GUILD_ID)).toBe(false);
    expect(raid.get(GUILD_ID)).toBeNull();
  });

  it('lista os modos que acabaram de expirar uma única vez', () => {
    raid.activate({ guildId: GUILD_ID, source: 'manual', minutes: 1 });
    expect(raid.expired()).toHaveLength(0);

    clock += MINUTE_MS + 1;
    expect(raid.expired()).toHaveLength(1);
    expect(raid.expired()).toHaveLength(0);
  });

  it('desliga manualmente e zera o contador', () => {
    raid.activate({ guildId: GUILD_ID, source: 'manual', minutes: 10 });
    expect(raid.deactivate(GUILD_ID)).toBe(true);
    expect(raid.deactivate(GUILD_ID)).toBe(false);
    expect(raid.isActive(GUILD_ID)).toBe(false);
  });
});
