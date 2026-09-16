import { describe, expect, it } from 'vitest';

import { toBits } from './availability';
import {
  fitsSquad,
  hardConflicts,
  isCompatiblePair,
  pairKey,
  proposeGroups,
  scoreProfiles,
  type SquadMatchField,
  type SquadMatchProfile,
} from './match';
import { SquadGameInputSchema } from '../config/squads';
import { SQUAD_MATCH_WEIGHTS } from '../constants';

const FRIDAY_EVENING = toBits([{ day: 5, block: 2 }]);
const SATURDAY_EVENING = toBits([{ day: 6, block: 2 }]);
const SUNDAY_EVENING = toBits([{ day: 0, block: 2 }]);

const { fields: FIELDS, squadSize: SQUAD_SIZE } = SquadGameInputSchema.parse({
  name: 'Helldivers 2',
  squadSize: 4,
  fields: [
    { key: 'platform', label: 'Plataforma', type: 'select', options: ['PC', 'PS5'], match: 'hard' },
    {
      key: 'difficulty',
      label: 'Dificuldade',
      type: 'select',
      options: ['7', '8', '9', '10'],
      match: 'soft',
    },
    {
      key: 'modes',
      label: 'Modos',
      type: 'tags',
      options: ['PvE', 'Farm', 'Speedrun'],
      match: 'hard',
    },
    { key: 'mic', label: 'Mic', type: 'select', options: ['Sim', 'Não'], match: 'soft' },
    { key: 'note', label: 'Observação', type: 'text' },
  ],
});

const ID = (n: number) => `1000000000000000${String(n).padStart(2, '0')}`;
const [A, B, C, D, E, F] = [1, 2, 3, 4, 5, 6].map(ID) as [
  string,
  string,
  string,
  string,
  string,
  string,
];

const profile = (
  userId: string,
  availability: number,
  answers: SquadMatchProfile['answers'] = {},
): SquadMatchProfile => ({ userId, availability, answers });

describe('scoreProfiles', () => {
  it('conta faixas em comum e soma os campos soft que batem', () => {
    const a = profile(A, FRIDAY_EVENING | SATURDAY_EVENING, {
      platform: 'PC',
      difficulty: '9',
      mic: 'Sim',
    });
    const b = profile(B, SATURDAY_EVENING, { platform: 'PC', difficulty: '9', mic: 'Não' });
    expect(scoreProfiles(FIELDS, a, b)).toEqual({
      score: 1 * SQUAD_MATCH_WEIGHTS.cell + 1 * SQUAD_MATCH_WEIGHTS.soft,
      hardOk: true,
      commonCells: 1,
    });
  });

  it('campo hard que não bate barra a dupla', () => {
    const a = profile(A, SATURDAY_EVENING, { platform: 'PC' });
    const b = profile(B, SATURDAY_EVENING, { platform: 'PS5' });
    const pair = scoreProfiles(FIELDS, a, b);
    expect(pair.hardOk).toBe(false);
    expect(isCompatiblePair(pair)).toBe(false);
  });

  it('tags batem com qualquer opção em comum', () => {
    const farm = profile(A, SATURDAY_EVENING, { modes: ['PvE', 'Farm'] });
    expect(
      scoreProfiles(FIELDS, farm, profile(B, SATURDAY_EVENING, { modes: ['Farm'] })).hardOk,
    ).toBe(true);
    expect(
      scoreProfiles(FIELDS, farm, profile(B, SATURDAY_EVENING, { modes: ['Speedrun'] })).hardOk,
    ).toBe(false);
  });

  it('resposta ausente não barra nem pontua', () => {
    const a = profile(A, SATURDAY_EVENING, { platform: 'PC', difficulty: '9' });
    const b = profile(B, SATURDAY_EVENING, {});
    expect(scoreProfiles(FIELDS, a, b)).toEqual({ score: 1, hardOk: true, commonCells: 1 });
  });

  it('texto livre não conta, nem com match errado vindo do banco', () => {
    const fields: SquadMatchField[] = [{ key: 'note', type: 'text', match: 'hard' }];
    const a = profile(A, SATURDAY_EVENING, { note: 'só à noite' });
    const b = profile(B, SATURDAY_EVENING, { note: 'de manhã' });
    expect(scoreProfiles(fields, a, b)).toEqual({ score: 1, hardOk: true, commonCells: 1 });
  });

  it('chave herdada do protótipo não vira resposta', () => {
    const fields: SquadMatchField[] = [{ key: 'constructor', type: 'select', match: 'hard' }];
    const a = profile(A, SATURDAY_EVENING, { constructor: 'PC' });
    expect(scoreProfiles(fields, a, profile(B, SATURDAY_EVENING)).hardOk).toBe(true);
  });

  it('sem faixa em comum a dupla não é compatível', () => {
    const pair = scoreProfiles(FIELDS, profile(A, FRIDAY_EVENING), profile(B, SATURDAY_EVENING));
    expect(pair).toEqual({ score: 0, hardOk: true, commonCells: 0 });
    expect(isCompatiblePair(pair)).toBe(false);
  });
});

describe('hardConflicts', () => {
  it('lista os campos hard que não batem, na ordem dos campos', () => {
    const a = profile(A, SATURDAY_EVENING, { platform: 'PC', modes: ['Farm'], difficulty: '7' });
    const b = profile(B, SATURDAY_EVENING, { platform: 'PS5', modes: ['PvE'], difficulty: '9' });
    expect(hardConflicts(FIELDS, a, b)).toEqual(['platform', 'modes']);
  });

  it('resposta ausente não conflita; texto livre e campo sem peso ficam de fora', () => {
    const fields: SquadMatchField[] = [
      { key: 'platform', type: 'select', match: 'hard' },
      { key: 'note', type: 'text', match: 'hard' },
      { key: 'mic', type: 'select', match: 'none' },
    ];
    const a = profile(A, SATURDAY_EVENING, { note: 'manhã', mic: 'Sim' });
    const b = profile(B, SATURDAY_EVENING, { platform: 'PC', note: 'noite', mic: 'Não' });
    expect(hardConflicts(fields, a, b)).toEqual([]);
  });

  it('concorda com o hardOk de scoreProfiles', () => {
    const answers: SquadMatchProfile['answers'][] = [
      {},
      { platform: 'PC' },
      { platform: 'PS5' },
      { modes: ['PvE'] },
      { platform: 'PC', modes: ['Farm', 'Speedrun'] },
    ];
    for (const left of answers) {
      for (const right of answers) {
        const a = profile(A, SATURDAY_EVENING, left);
        const b = profile(B, SATURDAY_EVENING, right);
        expect(hardConflicts(FIELDS, a, b).length === 0).toBe(scoreProfiles(FIELDS, a, b).hardOk);
      }
    }
  });
});

describe('fitsSquad', () => {
  const both = FRIDAY_EVENING | SATURDAY_EVENING;

  it('basta uma célula dividida com membros suficientes para uma party', () => {
    // Três membros e party de 4: o candidato precisa dividir uma célula com dois.
    const members = [FRIDAY_EVENING, FRIDAY_EVENING, SATURDAY_EVENING];
    expect(fitsSquad(FRIDAY_EVENING, members, 4)).toBe(true);
    expect(fitsSquad(SATURDAY_EVENING, members, 4)).toBe(false);
    expect(fitsSquad(SUNDAY_EVENING | both, members, 4)).toBe(true);
  });

  it('party menor que o squad pede menos gente na mesma célula', () => {
    const members = [FRIDAY_EVENING, SATURDAY_EVENING, SUNDAY_EVENING, SUNDAY_EVENING];
    expect(fitsSquad(SATURDAY_EVENING, members, 4)).toBe(false);
    expect(fitsSquad(SATURDAY_EVENING, members, 2)).toBe(true);
  });

  it('com um membro só, ainda exige uma célula em comum', () => {
    expect(fitsSquad(FRIDAY_EVENING, [FRIDAY_EVENING], 4)).toBe(true);
    expect(fitsSquad(SUNDAY_EVENING, [FRIDAY_EVENING], 4)).toBe(false);
  });

  it('sem grade de nenhum membro não barra, mas grade vazia do candidato sim', () => {
    expect(fitsSquad(SUNDAY_EVENING, [], 4)).toBe(true);
    expect(fitsSquad(0, [], 4)).toBe(false);
    expect(fitsSquad(0, [both], 4)).toBe(false);
  });
});

describe('pairKey', () => {
  it('é a mesma nos dois sentidos e diferente para outra dupla', () => {
    expect(pairKey(A, B)).toBe(pairKey(B, A));
    expect(pairKey(A, B)).not.toBe(pairKey(A, C));
  });
});

describe('proposeGroups', () => {
  const game = { squadSize: SQUAD_SIZE, fields: FIELDS };

  it('respeita o tamanho do squad', () => {
    const five = [A, B, C, D, E].map((id) => profile(id, SATURDAY_EVENING));
    const groups = proposeGroups(game, five);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.userIds).toEqual([A, B, C, D]);

    const six = [A, B, C, D, E, F].map((id) => profile(id, SATURDAY_EVENING));
    expect(proposeGroups({ ...game, squadSize: 3 }, six).map((group) => group.userIds)).toEqual([
      [A, B, C],
      [D, E, F],
    ]);
  });

  it('não junta dupla em cooldown', () => {
    const people = [A, B, C].map((id) => profile(id, SATURDAY_EVENING));
    const groups = proposeGroups(game, people, { blockedPairs: new Set([pairKey(B, A)]) });
    expect(groups.map((group) => group.userIds)).toEqual([[A, C]]);
  });

  it('não junta quem tem campo hard contra', () => {
    const people = [
      profile(A, SATURDAY_EVENING, { platform: 'PC' }),
      profile(B, SATURDAY_EVENING, { platform: 'PS5' }),
      profile(C, SATURDAY_EVENING, { platform: 'PC' }),
      profile(D, SATURDAY_EVENING, { platform: 'PS5' }),
    ];
    expect(proposeGroups(game, people).map((group) => group.userIds)).toEqual([
      [A, C],
      [B, D],
    ]);
  });

  it('o grupo inteiro divide ao menos uma faixa, não só cada dupla', () => {
    // A e B jogam sexta, A e C sábado, B e C domingo: toda dupla é compatível,
    // mas os três juntos não têm janela.
    const people = [
      profile(A, FRIDAY_EVENING | SATURDAY_EVENING),
      profile(B, FRIDAY_EVENING | SUNDAY_EVENING),
      profile(C, SATURDAY_EVENING | SUNDAY_EVENING),
    ];
    const groups = proposeGroups({ ...game, squadSize: 3 }, people);
    expect(groups).toEqual([{ userIds: [A, B], mask: FRIDAY_EVENING, slot: { day: 5, block: 2 } }]);
  });

  it('a semente é a dupla de maior nota, e o grupo cresce por quem soma mais', () => {
    const people = [
      profile(A, SATURDAY_EVENING, { mic: 'Não' }),
      profile(B, SATURDAY_EVENING, { mic: 'Não' }),
      profile(C, SATURDAY_EVENING | SUNDAY_EVENING, { mic: 'Sim', difficulty: '9' }),
      profile(D, SATURDAY_EVENING | SUNDAY_EVENING, { mic: 'Sim', difficulty: '9' }),
      profile(E, SATURDAY_EVENING, { mic: 'Sim' }),
    ];
    const groups = proposeGroups({ ...game, squadSize: 3 }, people);
    expect(groups.map((group) => group.userIds)).toEqual([
      [C, D, E],
      [A, B],
    ]);
    expect(groups[0]).toMatchObject({ mask: SATURDAY_EVENING, slot: { day: 6, block: 2 } });
  });

  it('cada jogador fica em um grupo só', () => {
    const people = [A, B, C, D, E].map((id) => profile(id, SATURDAY_EVENING));
    const ids = proposeGroups({ ...game, squadSize: 2 }, people).flatMap((group) => group.userIds);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a máscara do grupo é a interseção de todos, e a janela cai nela', () => {
    const people = [
      profile(A, FRIDAY_EVENING | SATURDAY_EVENING | SUNDAY_EVENING),
      profile(B, SATURDAY_EVENING | SUNDAY_EVENING),
      profile(C, SUNDAY_EVENING | SATURDAY_EVENING),
    ];
    const [group] = proposeGroups({ ...game, squadSize: 3 }, people);
    expect(group!.mask).toBe(SATURDAY_EVENING | SUNDAY_EVENING);
    expect(group!.slot).toEqual({ day: 0, block: 2 });
  });

  it('é determinístico: ordem da entrada e perfil repetido não mudam a saída', () => {
    const people = [
      profile(A, FRIDAY_EVENING | SATURDAY_EVENING, { platform: 'PC' }),
      profile(B, SATURDAY_EVENING, { platform: 'PC', mic: 'Sim' }),
      profile(C, FRIDAY_EVENING, { platform: 'PS5' }),
      profile(D, FRIDAY_EVENING | SATURDAY_EVENING, { platform: 'PC', mic: 'Sim' }),
      profile(E, FRIDAY_EVENING, {}),
      profile(F, SATURDAY_EVENING, { platform: 'PS5' }),
    ];
    const expected = proposeGroups(game, people);
    expect(proposeGroups(game, [...people].reverse())).toEqual(expected);
    expect(proposeGroups(game, [...people, people[0]!])).toEqual(expected);
  });

  it('sem dupla compatível não há grupo', () => {
    expect(proposeGroups(game, [])).toEqual([]);
    expect(proposeGroups(game, [profile(A, SATURDAY_EVENING)])).toEqual([]);
    expect(proposeGroups(game, [profile(A, FRIDAY_EVENING), profile(B, SATURDAY_EVENING)])).toEqual(
      [],
    );
  });

  it('recusa tamanho de squad menor que uma dupla', () => {
    expect(() => proposeGroups({ ...game, squadSize: 1 }, [])).toThrow(RangeError);
  });
});
