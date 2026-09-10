import { describe, expect, it } from 'vitest';

import {
  channelsToOptions,
  colorToHex,
  filterOptions,
  hexToColor,
  rolesToOptions,
  TEXT_CHANNEL_TYPES,
} from './discord-options';

import type { GuildChannelSummary, GuildRoleSummary } from '@goodbot/shared';

const OPTIONS = [
  { id: '100000000000000001', label: 'regras' },
  { id: '100000000000000002', label: 'Avisos Gerais' },
  { id: '100000000000000003', label: 'moderação' },
];

describe('filterOptions', () => {
  it('sem busca devolve tudo na ordem que veio', () => {
    expect(filterOptions(OPTIONS, '   ')).toEqual(OPTIONS);
  });

  it('casa por pedaço, ignorando caixa e acento', () => {
    expect(filterOptions(OPTIONS, 'GERAIS').map((o) => o.label)).toEqual(['Avisos Gerais']);
    expect(filterOptions(OPTIONS, 'moderacao').map((o) => o.label)).toEqual(['moderação']);
  });

  it('acha pelo começo do ID, para quem colou um snowflake', () => {
    expect(filterOptions(OPTIONS, '1000000000000000023')).toEqual([]);
    expect(filterOptions(OPTIONS, '100000000000000002').map((o) => o.label)).toEqual([
      'Avisos Gerais',
    ]);
  });

  it('busca que não casa devolve lista vazia', () => {
    expect(filterOptions(OPTIONS, 'zzz')).toEqual([]);
  });
});

describe('channelsToOptions', () => {
  const channels: GuildChannelSummary[] = [
    { id: '1', name: 'CATEGORIA', type: 4, parentId: null, position: 0 },
    { id: '2', name: 'geral', type: 0, parentId: '1', position: 2 },
    { id: '3', name: 'voz', type: 2, parentId: '1', position: 1 },
    { id: '4', name: 'avisos', type: 5, parentId: null, position: 0 },
  ];

  it('mantém só os tipos pedidos e agrupa pela categoria', () => {
    expect(channelsToOptions(channels, TEXT_CHANNEL_TYPES)).toEqual([
      { id: '4', label: 'avisos', group: 'SEM CATEGORIA' },
      { id: '2', label: 'geral', group: 'CATEGORIA' },
    ]);
  });

  it('inclui voz quando o campo pede voz', () => {
    expect(channelsToOptions(channels, [2]).map((o) => o.label)).toEqual(['voz']);
  });
});

describe('rolesToOptions', () => {
  it('tira o @everyone e ordena do cargo mais alto para o mais baixo', () => {
    const roles: GuildRoleSummary[] = [
      {
        id: '1',
        name: '@everyone',
        color: 0,
        position: 0,
        managed: false,
        hoist: false,
        mentionable: false,
        permissions: '0',
      },
      {
        id: '2',
        name: 'Membro',
        color: 0,
        position: 1,
        managed: false,
        hoist: false,
        mentionable: false,
        permissions: '0',
      },
      {
        id: '3',
        name: 'Admin',
        color: 0xdc143c,
        position: 9,
        managed: false,
        hoist: false,
        mentionable: false,
        permissions: '8',
      },
    ];
    expect(rolesToOptions(roles).map((o) => o.label)).toEqual(['Admin', 'Membro']);
  });

  it('inclui o @everyone sem o arroba quando o campo pede', () => {
    const roles: GuildRoleSummary[] = [
      {
        id: '1',
        name: '@everyone',
        color: 0,
        position: 0,
        managed: false,
        hoist: false,
        mentionable: false,
        permissions: '0',
      },
      {
        id: '2',
        name: 'Membro',
        color: 0,
        position: 1,
        managed: false,
        hoist: false,
        mentionable: false,
        permissions: '0',
      },
    ];
    expect(rolesToOptions(roles, { includeEveryone: true }).map((o) => o.label)).toEqual([
      'Membro',
      'everyone',
    ]);
  });
});

describe('cor do embed', () => {
  it('vai e volta entre inteiro RGB e hex', () => {
    expect(colorToHex(0xdc143c)).toBe('#dc143c');
    expect(colorToHex(0)).toBe('#000000');
    expect(hexToColor('#DC143C')).toBe(0xdc143c);
    expect(hexToColor('dc143c')).toBe(0xdc143c);
  });

  it('hex incompleto não vira número', () => {
    expect(hexToColor('#dc14')).toBeNull();
    expect(hexToColor('')).toBeNull();
  });
});
