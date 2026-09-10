import { describe, expect, it } from 'vitest';

import {
  parseEmojiInput,
  resolveClick,
  resolveReaction,
  resolveSelect,
  toEmojiIdentifier,
} from './reaction-roles';

const A = '111111111111111111';
const B = '222222222222222222';
const C = '333333333333333333';
const PANEL = [A, B, C];

describe('resolveClick', () => {
  it('single: escolher outro cargo troca, deixando só o último', () => {
    expect(
      resolveClick({ mode: 'single', roleId: B, panelRoleIds: PANEL, currentRoleIds: [A] }),
    ).toEqual({ add: [B], remove: [A] });
  });

  it('single: dois cliques seguidos deixam só o último dos três', () => {
    const first = resolveClick({
      mode: 'single',
      roleId: A,
      panelRoleIds: PANEL,
      currentRoleIds: [],
    });
    expect(first).toEqual({ add: [A], remove: [] });
    const second = resolveClick({
      mode: 'single',
      roleId: C,
      panelRoleIds: PANEL,
      currentRoleIds: [A],
    });
    expect(second).toEqual({ add: [C], remove: [A] });
  });

  it('single: clicar no que já se tem não mexe em nada', () => {
    expect(
      resolveClick({ mode: 'single', roleId: A, panelRoleIds: PANEL, currentRoleIds: [A] }),
    ).toEqual({ add: [], remove: [] });
  });

  it('single: não mexe em cargos de fora do painel', () => {
    const fora = '999999999999999999';
    expect(
      resolveClick({ mode: 'single', roleId: B, panelRoleIds: PANEL, currentRoleIds: [A, fora] }),
    ).toEqual({ add: [B], remove: [A] });
  });

  it('multiple: só acumula, nunca remove', () => {
    expect(
      resolveClick({ mode: 'multiple', roleId: B, panelRoleIds: PANEL, currentRoleIds: [A] }),
    ).toEqual({ add: [B], remove: [] });
    expect(
      resolveClick({ mode: 'multiple', roleId: A, panelRoleIds: PANEL, currentRoleIds: [A] }),
    ).toEqual({ add: [], remove: [] });
  });

  it('toggle: o segundo clique tira o cargo', () => {
    expect(
      resolveClick({ mode: 'toggle', roleId: A, panelRoleIds: PANEL, currentRoleIds: [] }),
    ).toEqual({ add: [A], remove: [] });
    expect(
      resolveClick({ mode: 'toggle', roleId: A, panelRoleIds: PANEL, currentRoleIds: [A] }),
    ).toEqual({ add: [], remove: [A] });
  });
});

describe('resolveSelect', () => {
  it('single: ignora tudo além da primeira opção', () => {
    expect(
      resolveSelect({
        mode: 'single',
        selectedRoleIds: [B, C],
        panelRoleIds: PANEL,
        currentRoleIds: [A],
      }),
    ).toEqual({ add: [B], remove: [A] });
  });

  it('toggle: a seleção passa a ser o conjunto exato do painel', () => {
    expect(
      resolveSelect({
        mode: 'toggle',
        selectedRoleIds: [B],
        panelRoleIds: PANEL,
        currentRoleIds: [A, C],
      }),
    ).toEqual({ add: [B], remove: [A, C] });
  });

  it('toggle: desmarcar tudo tira os cargos do painel', () => {
    expect(
      resolveSelect({
        mode: 'toggle',
        selectedRoleIds: [],
        panelRoleIds: PANEL,
        currentRoleIds: [A],
      }),
    ).toEqual({ add: [], remove: [A] });
  });

  it('multiple: soma sem tirar o que já havia', () => {
    expect(
      resolveSelect({
        mode: 'multiple',
        selectedRoleIds: [B],
        panelRoleIds: PANEL,
        currentRoleIds: [A],
      }),
    ).toEqual({ add: [B], remove: [] });
  });

  it('descarta valores que não são do painel', () => {
    expect(
      resolveSelect({
        mode: 'multiple',
        selectedRoleIds: ['999999999999999999'],
        panelRoleIds: PANEL,
        currentRoleIds: [],
      }),
    ).toEqual({ add: [], remove: [] });
  });
});

describe('resolveReaction', () => {
  it('tirar a reação sempre tira o cargo', () => {
    expect(
      resolveReaction({
        mode: 'multiple',
        roleId: A,
        added: false,
        panelRoleIds: PANEL,
        currentRoleIds: [A],
      }),
    ).toEqual({ add: [], remove: [A] });
  });

  it('reagir de novo no mesmo emoji não tira o cargo no modo toggle', () => {
    expect(
      resolveReaction({
        mode: 'toggle',
        roleId: A,
        added: true,
        panelRoleIds: PANEL,
        currentRoleIds: [A],
      }),
    ).toEqual({ add: [], remove: [] });
  });

  it('single continua trocando de cargo por reação', () => {
    expect(
      resolveReaction({
        mode: 'single',
        roleId: B,
        added: true,
        panelRoleIds: PANEL,
        currentRoleIds: [A],
      }),
    ).toEqual({ add: [B], remove: [A] });
  });
});

describe('emoji', () => {
  it('normaliza o emoji customizado escrito pelo usuário', () => {
    expect(parseEmojiInput('<:goodbot:123456789012345678>')).toBe('goodbot:123456789012345678');
    expect(parseEmojiInput('<a:girando:123456789012345678>')).toBe('girando:123456789012345678');
    expect(parseEmojiInput('goodbot:123456789012345678')).toBe('goodbot:123456789012345678');
  });

  it('aceita unicode e recusa texto solto', () => {
    expect(parseEmojiInput('🎮')).toBe('🎮');
    expect(parseEmojiInput('joga aí')).toBeNull();
    expect(parseEmojiInput('   ')).toBeNull();
  });

  it('devolve ao discord.js o formato que ele espera', () => {
    expect(toEmojiIdentifier('goodbot:123456789012345678')).toBe('<:goodbot:123456789012345678>');
    expect(toEmojiIdentifier('🎮')).toBe('🎮');
  });
});
