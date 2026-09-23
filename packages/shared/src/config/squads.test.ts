import { describe, expect, it } from 'vitest';

import { GREEK_ROOM_NAMES, LFG_MAX_GAME_NAMES } from '../constants';
import { parseModuleConfigOrDefault } from './index';
import { DEFAULT_SQUADS_CONFIG, normalizeGameName, SquadsConfigSchema } from './squads';

const ROLE_A = '111111111111111111';
const ROLE_B = '222222222222222222';

describe('SquadsConfigSchema', () => {
  it('nasce desligado, sem ids e com os padrões do PRD', () => {
    expect(SquadsConfigSchema.parse({})).toEqual(DEFAULT_SQUADS_CONFIG);
    expect(DEFAULT_SQUADS_CONFIG).toEqual({
      version: 1,
      enabled: false,
      searchRoleId: null,
      optOutRoleId: null,
      panelChannelId: null,
      panelMessageId: null,
      categoryId: null,
      createChannelId: null,
      roomSize: 4,
      graceMinutes: 2,
      searchTtlMinutes: 120,
      gameNames: ['HELLDIVERS™ 2'],
    });
  });

  it('cada parse ganha a sua cópia da lista de jogos padrão', () => {
    const first = SquadsConfigSchema.parse({});
    first.gameNames.push('Outro');
    expect(SquadsConfigSchema.parse({}).gameNames).toEqual(['HELLDIVERS™ 2']);
  });

  it('lê o jsonb do módulo antigo descartando os campos que saíram', () => {
    const legacy = {
      version: 1,
      enabled: true,
      searchChannelId: ROLE_A,
      searchMessageId: ROLE_B,
      voicePoolIds: [ROLE_A],
      blocks: [],
      proposalTtlHours: 72,
      channelNaming: 'squad-{name}',
    };
    const result = parseModuleConfigOrDefault('squads', legacy);
    expect(result.valid).toBe(true);
    expect(result.config).toEqual({ ...DEFAULT_SQUADS_CONFIG, enabled: true });
    expect(result.config).not.toHaveProperty('searchChannelId');
  });

  it.each([
    ['roomSize', 1],
    ['roomSize', 11],
    ['roomSize', 3.5],
    ['graceMinutes', -1],
    ['graceMinutes', 11],
    ['searchTtlMinutes', 14],
    ['searchTtlMinutes', 721],
  ])('recusa %s = %s', (field, value) => {
    expect(SquadsConfigSchema.safeParse({ [field]: value }).success).toBe(false);
  });

  it('aceita as bordas das faixas', () => {
    const config = SquadsConfigSchema.parse({
      roomSize: 10,
      graceMinutes: 0,
      searchTtlMinutes: 15,
    });
    expect(config).toMatchObject({ roomSize: 10, graceMinutes: 0, searchTtlMinutes: 15 });
  });

  it('recusa id que não é snowflake', () => {
    expect(SquadsConfigSchema.safeParse({ createChannelId: 'abc' }).success).toBe(false);
  });

  it('recusa o mesmo cargo para busca e sem aviso', () => {
    const result = SquadsConfigSchema.safeParse({ searchRoleId: ROLE_A, optOutRoleId: ROLE_A });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['optOutRoleId']);
    expect(
      SquadsConfigSchema.safeParse({ searchRoleId: ROLE_A, optOutRoleId: ROLE_B }).success,
    ).toBe(true);
  });

  describe('gameNames', () => {
    it('tira repetido pela forma normalizada e fica a primeira grafia', () => {
      const config = SquadsConfigSchema.parse({
        gameNames: ['  HELLDIVERS™ 2 ', 'helldivers 2', 'Deep Rock Galactic'],
      });
      expect(config.gameNames).toEqual(['HELLDIVERS™ 2', 'Deep Rock Galactic']);
    });

    it('aceita lista vazia (desliga só o aviso automático)', () => {
      expect(SquadsConfigSchema.parse({ gameNames: [] }).gameNames).toEqual([]);
    });

    it('recusa nome em branco ou só com ™', () => {
      expect(SquadsConfigSchema.safeParse({ gameNames: ['  '] }).success).toBe(false);
      expect(SquadsConfigSchema.safeParse({ gameNames: ['™'] }).success).toBe(false);
    });

    it(`recusa mais de ${String(LFG_MAX_GAME_NAMES)} jogos`, () => {
      const names = Array.from({ length: LFG_MAX_GAME_NAMES + 1 }, (_, i) => `Jogo ${String(i)}`);
      expect(SquadsConfigSchema.safeParse({ gameNames: names }).success).toBe(false);
    });
  });
});

describe('normalizeGameName', () => {
  it('ignora ™, ®, caixa e espaço extra', () => {
    expect(normalizeGameName('HELLDIVERS™ 2')).toBe('helldivers 2');
    expect(normalizeGameName('  Helldivers   2 ')).toBe('helldivers 2');
    expect(normalizeGameName('Tom Clancy’s Rainbow Six® Siege')).toBe(
      'tom clancy’s rainbow six siege',
    );
  });
});

describe('GREEK_ROOM_NAMES', () => {
  it('tem os 24 nomes, sem repetição, começando em Alfa e terminando em Ômega', () => {
    expect(GREEK_ROOM_NAMES).toHaveLength(24);
    expect(new Set(GREEK_ROOM_NAMES).size).toBe(24);
    expect(GREEK_ROOM_NAMES[0]).toBe('Alfa');
    expect(GREEK_ROOM_NAMES[23]).toBe('Ômega');
  });
});
