import { describe, expect, it } from 'vitest';

import { decideJoinVote, tallyJoinVote, type JoinVoteOutcome } from './join-vote';

const members = (count: number) => Array.from({ length: count }, (_, index) => `m${String(index)}`);

/** `for` e `against` são quantos votos, tirados dos primeiros membros em ordem. */
function decide(size: number, inFavor: number, against: number, expired = false): JoinVoteOutcome {
  const ids = members(size);
  return decideJoinVote({
    memberIds: ids,
    forIds: ids.slice(0, inFavor),
    againstIds: ids.slice(inFavor, inFavor + against),
    expired,
  });
}

describe('decideJoinVote', () => {
  it.each([
    // membros, a favor, contra, resultado
    [2, 0, 0, 'open'],
    [2, 1, 0, 'accepted'],
    [2, 1, 1, 'accepted'],
    [2, 0, 1, 'open'],
    [2, 0, 2, 'declined'],
    [3, 1, 0, 'open'],
    [3, 1, 1, 'open'],
    [3, 2, 0, 'accepted'],
    [3, 2, 1, 'accepted'],
    [3, 0, 2, 'declined'],
    [3, 1, 2, 'declined'],
    [4, 1, 1, 'open'],
    [4, 2, 0, 'accepted'],
    [4, 2, 2, 'accepted'],
    [4, 1, 2, 'open'],
    [4, 1, 3, 'declined'],
    [4, 0, 3, 'declined'],
    [7, 3, 0, 'open'],
    [7, 3, 3, 'open'],
    [7, 4, 0, 'accepted'],
    [7, 3, 4, 'declined'],
    [7, 0, 4, 'declined'],
  ] as const)('%i membros, %i a favor e %i contra: %s', (size, inFavor, against, outcome) => {
    expect(decide(size, inFavor, against)).toBe(outcome);
  });

  it('empate com todos votando entra', () => {
    expect(decide(2, 1, 1)).toBe('accepted');
    expect(decide(4, 2, 2)).toBe('accepted');
    expect(decide(6, 3, 3)).toBe('accepted');
  });

  it.each([
    // membros, a favor, contra, resultado no prazo
    [3, 0, 0, 'expired'],
    [3, 1, 0, 'accepted'],
    [3, 1, 1, 'accepted'],
    [3, 0, 1, 'expired'],
    [4, 1, 2, 'expired'],
    [7, 2, 2, 'accepted'],
    [7, 2, 3, 'expired'],
  ] as const)(
    'prazo vencido com %i membros, %i a favor e %i contra: %s',
    (size, inFavor, against, outcome) => {
      expect(decide(size, inFavor, against, true)).toBe(outcome);
    },
  );

  it('voto de quem saiu do squad não conta, e a conta usa os membros de agora', () => {
    // Três membros, um a favor e um contra: aberto. O que votou contra sai.
    const vote = { forIds: ['m0'], againstIds: ['m1'], expired: false };
    expect(decideJoinVote({ memberIds: ['m0', 'm1', 'm2'], ...vote })).toBe('open');
    expect(decideJoinVote({ memberIds: ['m0', 'm2'], ...vote })).toBe('accepted');
    // Quem saiu foi o que votou a favor: dois membros, um contra, ainda aberto.
    expect(decideJoinVote({ memberIds: ['m1', 'm2'], ...vote })).toBe('open');
  });

  it('squad sem membros não aceita ninguém', () => {
    const empty = { memberIds: [], forIds: ['m0'], againstIds: [] };
    expect(decideJoinVote({ ...empty, expired: false })).toBe('open');
    expect(decideJoinVote({ ...empty, expired: true })).toBe('expired');
  });
});

describe('tallyJoinVote', () => {
  it('conta só membros, sem repetir, e quem está nas duas listas conta a favor', () => {
    expect(
      tallyJoinVote({
        memberIds: ['a', 'b', 'c', 'd'],
        forIds: ['a', 'a', 'x'],
        againstIds: ['a', 'b', 'y'],
      }),
    ).toEqual({ members: 4, inFavor: 1, against: 1, missing: 2 });
  });
});
