import { describe, expect, it } from 'vitest';

import squad, { pickGame, pickSquad, pickStatsGame } from './squad';

import type { Squad, SquadGame } from '@goodbot/db';

const json = squad.data.toJSON();

const game = (id: string, name: string) => ({ id, name }) as SquadGame;
const squadRow = (id: string, name: string, textChannelId: string | null) =>
  ({ id, name, textChannelId }) as Squad;

function codeOf(run: () => unknown): string | null {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code ?? 'sem código';
  }
  return null;
}

describe('/squad', () => {
  it('é do módulo squads, aberto a membros e sem adiar sozinho', () => {
    expect(squad.module).toBe('squads');
    expect(squad.level).toBe('member');
    expect(squad.ephemeral).toBe(true);
    // `/squad perfil` responde com modal: o adiamento automático quebraria o `showModal`.
    expect(squad.opensModal).toBe(true);
    expect(squad.defer).toBeFalsy();
  });

  it('tem os subcomandos do módulo', () => {
    expect((json.options ?? []).map((option) => option.name).sort()).toEqual([
      'convidar',
      'painel',
      'perfil',
      'procurar',
      'renomear',
      'sair',
      'stats',
      'status',
    ]);
  });

  it('stats tem pessoa opcional e jogo com autocomplete', () => {
    const stats = (json.options ?? []).find((option) => option.name === 'stats') as {
      options?: { name: string; required?: boolean; autocomplete?: boolean }[];
    };
    expect(stats.options?.map((option) => option.name)).toEqual(['pessoa', 'jogo']);
    expect(stats.options?.every((option) => !option.required)).toBe(true);
    expect(stats.options?.find((option) => option.name === 'jogo')?.autocomplete).toBe(true);
  });
});

describe('pickGame', () => {
  const hd2 = game('g1', 'Helldivers 2');
  const drg = game('g2', 'Deep Rock Galactic');

  it('sem opção e com um jogo só, usa ele', () => {
    expect(pickGame([hd2], null)).toBe(hd2);
  });

  it('aceita o id do autocomplete ou o nome digitado', () => {
    expect(pickGame([hd2, drg], 'g2')).toBe(drg);
    expect(pickGame([hd2, drg], '  helldivers 2 ')).toBe(hd2);
  });

  it('explica quando não há jogo, quando há vários ou quando o nome não existe', () => {
    expect(codeOf(() => pickGame([], null))).toBe('SQUADS_NO_GAMES');
    expect(codeOf(() => pickGame([hd2, drg], null))).toBe('CHOOSE_GAME');
    expect(codeOf(() => pickGame([hd2], 'Minecraft'))).toBe('GAME_NOT_FOUND');
  });
});

describe('pickStatsGame', () => {
  const hd2 = game('g1', 'Helldivers 2');
  const drg = game('g2', 'Deep Rock Galactic');
  const alfa = { ...squadRow('s1', 'Alfa', '800000000000000001'), gameId: 'g2' } as Squad;

  it('sem opção, usa o jogo do squad de cujo canal o comando saiu', () => {
    expect(pickStatsGame([hd2, drg], [alfa], null, '800000000000000001')).toBe(drg);
  });

  it('a opção ganha do canal', () => {
    expect(pickStatsGame([hd2, drg], [alfa], 'g1', '800000000000000001')).toBe(hd2);
  });

  it('fora do canal de um squad, vale a regra do jogo único', () => {
    expect(pickStatsGame([hd2], [alfa], null, '900000000000000001')).toBe(hd2);
    expect(codeOf(() => pickStatsGame([hd2, drg], [], null, null))).toBe('CHOOSE_GAME');
  });
});

describe('pickSquad', () => {
  const alfa = squadRow('s1', 'Alfa', '800000000000000001');
  const bravo = squadRow('s2', 'Bravo', '800000000000000002');

  it('prefere o squad do canal onde o comando rodou', () => {
    expect(pickSquad([alfa, bravo], null, '800000000000000002')).toBe(bravo);
  });

  it('com um squad só, usa ele; com vários, pede para escolher', () => {
    expect(pickSquad([alfa], null, '1')).toBe(alfa);
    expect(codeOf(() => pickSquad([alfa, bravo], null, '1'))).toBe('CHOOSE_SQUAD');
    expect(codeOf(() => pickSquad([], null, null))).toBe('NO_SQUAD');
  });

  it('a opção vale por id ou nome, mas só entre os squads da pessoa', () => {
    expect(pickSquad([alfa, bravo], 'bravo', null)).toBe(bravo);
    expect(pickSquad([alfa, bravo], 's1', '800000000000000002')).toBe(alfa);
    expect(codeOf(() => pickSquad([alfa], 'Charlie', null))).toBe('NOT_A_MEMBER');
  });
});
