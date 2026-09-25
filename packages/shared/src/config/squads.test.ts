import { describe, expect, it } from 'vitest';

import { GREEK_ROOM_NAMES } from '../constants';
import { parseModuleConfigOrDefault } from './index';
import { DEFAULT_SQUADS_CONFIG, SquadsConfigSchema } from './squads';

const ID_A = '111111111111111111';
const ID_B = '222222222222222222';
const ID_C = '333333333333333333';

describe('SquadsConfigSchema', () => {
  it('nasce desligado, sem ids e com os padrões do PRD', () => {
    expect(SquadsConfigSchema.parse({})).toEqual(DEFAULT_SQUADS_CONFIG);
    expect(DEFAULT_SQUADS_CONFIG).toEqual({
      version: 1,
      enabled: false,
      chatChannelId: null,
      deskChannelId: null,
      agendaChannelId: null,
      categoryId: null,
      notifyRoleId: null,
      roomSize: 4,
      graceMinutes: 2,
      chatGuideMessageId: null,
      deskGuideMessageId: null,
      deskButtonsMessageId: null,
    });
  });

  it('lê o jsonb da v1.9 descartando os campos que saíram', () => {
    const legacy = {
      version: 1,
      enabled: true,
      searchRoleId: ID_A,
      optOutRoleId: ID_B,
      panelChannelId: ID_C,
      panelMessageId: ID_A,
      createChannelId: ID_B,
      searchTtlMinutes: 120,
      gameNames: ['HELLDIVERS™ 2'],
      categoryId: ID_C,
      agendaChannelId: ID_A,
      roomSize: 6,
    };
    const result = parseModuleConfigOrDefault('squads', legacy);
    expect(result.valid).toBe(true);
    expect(result.config).toEqual({
      ...DEFAULT_SQUADS_CONFIG,
      enabled: true,
      categoryId: ID_C,
      agendaChannelId: ID_A,
      roomSize: 6,
    });
    for (const gone of ['searchRoleId', 'optOutRoleId', 'panelChannelId', 'gameNames']) {
      expect(result.config).not.toHaveProperty(gone);
    }
  });

  it('lê o jsonb do módulo de antes da v1.8 também', () => {
    const legacy = { version: 1, enabled: true, searchChannelId: ID_A, voicePoolIds: [ID_A] };
    const result = parseModuleConfigOrDefault('squads', legacy);
    expect(result.valid).toBe(true);
    expect(result.config).toEqual({ ...DEFAULT_SQUADS_CONFIG, enabled: true });
  });

  it('preserva os ids das mensagens do bot', () => {
    const config = SquadsConfigSchema.parse({
      chatGuideMessageId: ID_A,
      deskGuideMessageId: ID_B,
      deskButtonsMessageId: ID_C,
    });
    expect(config).toMatchObject({
      chatGuideMessageId: ID_A,
      deskGuideMessageId: ID_B,
      deskButtonsMessageId: ID_C,
    });
  });

  it.each([
    ['roomSize', 1],
    ['roomSize', 11],
    ['roomSize', 3.5],
    ['graceMinutes', -1],
    ['graceMinutes', 11],
  ])('recusa %s = %s', (field, value) => {
    expect(SquadsConfigSchema.safeParse({ [field]: value }).success).toBe(false);
  });

  it('aceita as bordas das faixas', () => {
    const config = SquadsConfigSchema.parse({ roomSize: 10, graceMinutes: 0 });
    expect(config).toMatchObject({ roomSize: 10, graceMinutes: 0 });
    expect(SquadsConfigSchema.parse({ roomSize: 2 }).roomSize).toBe(2);
  });

  it('recusa id que não é snowflake', () => {
    expect(SquadsConfigSchema.safeParse({ notifyRoleId: 'abc' }).success).toBe(false);
  });

  it.each([
    ['chatChannelId', 'deskChannelId', 'deskChannelId'],
    ['chatChannelId', 'agendaChannelId', 'agendaChannelId'],
    ['deskChannelId', 'agendaChannelId', 'agendaChannelId'],
  ])('recusa %s igual a %s', (a, b, path) => {
    const result = SquadsConfigSchema.safeParse({ [a]: ID_A, [b]: ID_A });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([path]);
  });

  it('aceita os três canais diferentes, e canal vazio não conta como repetido', () => {
    expect(
      SquadsConfigSchema.safeParse({
        chatChannelId: ID_A,
        deskChannelId: ID_B,
        agendaChannelId: ID_C,
      }).success,
    ).toBe(true);
    expect(SquadsConfigSchema.safeParse({ chatChannelId: ID_A }).success).toBe(true);
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
