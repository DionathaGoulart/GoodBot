import { describe, expect, it } from 'vitest';

import { LFG_INVITE_MAX_PER_BATCH } from '../constants';
import { UserFacingError } from '../errors';
import {
  acceptInvite,
  acceptRequest,
  declineInvite,
  entryOf,
  freeSlots,
  invitedEntries,
  inviteToRoster,
  isRosterFull,
  joinRoster,
  kickFromRoster,
  leaveRoster,
  rejectRequest,
  requestedEntries,
  seatedEntries,
  setRosterSlots,
  setRosterVisibility,
} from './roster';

import type { Roster } from './roster';

const HOST = '100000000000000001';
const ANA = '100000000000000002';
const BIA = '100000000000000003';
const CAIO = '100000000000000004';
const DUDA = '100000000000000005';

function roster(overrides: Partial<Roster> = {}): Roster {
  return {
    hostId: HOST,
    slots: 3,
    visibility: 'open',
    entries: [{ userId: HOST, status: 'host', joinedAt: 0 }],
    ...overrides,
  };
}

function ids(entries: { userId: string }[]): string[] {
  return entries.map((entry) => entry.userId);
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof UserFacingError) return error.code;
    throw error;
  }
  throw new Error('não lançou');
}

/** Pública com HOST, ANA e BIA: três de três, lotada. */
function fullOpen(): Roster {
  let r = roster();
  r = joinRoster(r, ANA, 1).roster;
  return joinRoster(r, BIA, 2).roster;
}

describe('joinRoster', () => {
  it.each([
    ['open', 'going'],
    ['closed', 'requested'],
  ] as const)('%s com vaga: %s', (visibility, outcome) => {
    const change = joinRoster(roster({ visibility }), ANA, 1);
    expect(change.outcome).toBe(outcome);
    expect(entryOf(change.roster, ANA)?.status).toBe(outcome);
  });

  it('pedido numa privada não ocupa vaga', () => {
    const change = joinRoster(roster({ visibility: 'closed' }), ANA, 1);
    expect(freeSlots(change.roster)).toBe(2);
    expect(ids(requestedEntries(change.roster))).toEqual([ANA]);
  });

  it.each(['open', 'closed'] as const)('%s lotada recusa com "lotou", sem fila', (visibility) => {
    const r = { ...fullOpen(), visibility };
    expect(isRosterFull(r)).toBe(true);
    expect(code(() => joinRoster(r, CAIO, 3))).toBe('LFG_FULL');
  });

  it('não entra duas vezes, nem o host, nem quem já pediu', () => {
    const r = joinRoster(roster(), ANA, 1).roster;
    expect(code(() => joinRoster(r, ANA, 2))).toBe('LFG_ALREADY_IN');
    expect(code(() => joinRoster(r, HOST, 2))).toBe('LFG_ALREADY_IN');
    const closed = joinRoster(roster({ visibility: 'closed' }), BIA, 1).roster;
    expect(code(() => joinRoster(closed, BIA, 2))).toBe('LFG_ALREADY_IN');
  });

  it('quem tinha convite e clica para entrar aceita o convite, até numa privada', () => {
    const r = inviteToRoster(roster({ visibility: 'closed' }), [ANA], HOST, 1).roster;
    const change = joinRoster(r, ANA, 2);
    expect(change.outcome).toBe('going');
    expect(entryOf(change.roster, ANA)).toMatchObject({ status: 'going', invitedBy: HOST });
  });
});

describe('leaveRoster', () => {
  it.each([
    ['going', roster()],
    ['requested', roster({ visibility: 'closed' })],
  ] as const)('sai de %s e libera o lugar sem puxar ninguém', (status, base) => {
    const r = joinRoster(base, ANA, 1).roster;
    const change = leaveRoster(r, ANA);
    expect(change.outcome).toBe(status);
    expect(change.seated).toEqual([]);
    expect(entryOf(change.roster, ANA)).toBeUndefined();
  });

  it('sai de um convite pendente', () => {
    const r = inviteToRoster(roster(), [ANA], HOST, 1).roster;
    expect(leaveRoster(r, ANA).outcome).toBe('invited');
  });

  it('o host não sai e quem não está recebe erro', () => {
    expect(code(() => leaveRoster(roster(), HOST))).toBe('LFG_HOST_CANNOT_LEAVE');
    expect(code(() => leaveRoster(roster(), ANA))).toBe('LFG_NOT_IN');
  });
});

describe('pedido numa privada', () => {
  it('aceito com vaga senta; lotada recusa e pede para subir as vagas', () => {
    let r = roster({ visibility: 'closed', slots: 2 });
    r = joinRoster(r, ANA, 1).roster;
    r = joinRoster(r, BIA, 2).roster;
    const first = acceptRequest(r, ANA);
    expect(first.outcome).toBe('going');
    expect(code(() => acceptRequest(first.roster, BIA))).toBe('LFG_FULL');
    expect(entryOf(first.roster, BIA)?.status).toBe('requested');
  });

  it('recusado some e pode pedir de novo', () => {
    let r = joinRoster(roster({ visibility: 'closed' }), ANA, 1).roster;
    r = rejectRequest(r, ANA).roster;
    expect(entryOf(r, ANA)).toBeUndefined();
    expect(joinRoster(r, ANA, 5).outcome).toBe('requested');
  });

  it('pedido respondido não se responde de novo', () => {
    let r = joinRoster(roster({ visibility: 'closed' }), ANA, 1).roster;
    r = acceptRequest(r, ANA).roster;
    expect(code(() => acceptRequest(r, ANA))).toBe('LFG_REQUEST_GONE');
    expect(code(() => rejectRequest(r, ANA))).toBe('LFG_REQUEST_GONE');
    expect(code(() => acceptRequest(r, BIA))).toBe('LFG_REQUEST_GONE');
  });

  it('convite não se responde como pedido', () => {
    const r = inviteToRoster(roster(), [ANA], HOST, 1).roster;
    expect(code(() => acceptRequest(r, ANA))).toBe('LFG_REQUEST_GONE');
  });
});

describe('inviteToRoster', () => {
  it('convida com invitedBy e pula quem já está, em qualquer papel', () => {
    let r = roster({ visibility: 'closed' });
    r = joinRoster(r, ANA, 1).roster;
    r = inviteToRoster(r, [BIA], HOST, 2).roster;
    const change = inviteToRoster(r, [ANA, BIA, CAIO, HOST, CAIO], HOST, 3);
    expect(change.outcome).toEqual({ invited: [CAIO], skipped: [ANA, BIA, HOST] });
    expect(ids(invitedEntries(change.roster))).toEqual([BIA, CAIO]);
    expect(entryOf(change.roster, CAIO)).toMatchObject({ status: 'invited', invitedBy: HOST });
  });

  it('convite pendente não ocupa vaga, e convidar numa lotada vale', () => {
    const change = inviteToRoster(fullOpen(), [CAIO], HOST, 3);
    expect(change.outcome.invited).toEqual([CAIO]);
    expect(isRosterFull(change.roster)).toBe(true);
  });

  it(`recusa lista vazia e mais de ${String(LFG_INVITE_MAX_PER_BATCH)} de uma vez`, () => {
    expect(code(() => inviteToRoster(roster(), [], HOST, 1))).toBe('LFG_INVITE_EMPTY');
    const many = Array.from({ length: LFG_INVITE_MAX_PER_BATCH + 1 }, (_, i) =>
      String(200000000000000000n + BigInt(i)),
    );
    expect(code(() => inviteToRoster(roster(), many, HOST, 1))).toBe('LFG_INVITE_TOO_MANY');
    expect(
      inviteToRoster(roster(), many.slice(0, LFG_INVITE_MAX_PER_BATCH), HOST, 1).outcome.invited,
    ).toHaveLength(LFG_INVITE_MAX_PER_BATCH);
  });
});

describe('acceptInvite e declineInvite', () => {
  it('aceitar entra direto em "vão", até numa privada', () => {
    const r = inviteToRoster(roster({ visibility: 'closed' }), [ANA], HOST, 1).roster;
    const change = acceptInvite(r, ANA);
    expect(change.outcome).toBe('going');
    expect(ids(seatedEntries(change.roster))).toEqual([HOST, ANA]);
  });

  it('aceitar com a lista cheia recusa e o convite continua', () => {
    const r = inviteToRoster(fullOpen(), [CAIO], HOST, 3).roster;
    expect(code(() => acceptInvite(r, CAIO))).toBe('LFG_FULL');
    expect(entryOf(r, CAIO)?.status).toBe('invited');
  });

  it('recusar tira da lista', () => {
    const r = inviteToRoster(roster(), [ANA], HOST, 1).roster;
    const change = declineInvite(r, ANA);
    expect(change.outcome).toBe('declined');
    expect(entryOf(change.roster, ANA)).toBeUndefined();
  });

  it('convite respondido, ou que nunca existiu, não se responde', () => {
    const r = acceptInvite(inviteToRoster(roster(), [ANA], HOST, 1).roster, ANA).roster;
    expect(code(() => acceptInvite(r, ANA))).toBe('LFG_INVITE_GONE');
    expect(code(() => declineInvite(r, ANA))).toBe('LFG_INVITE_GONE');
    expect(code(() => declineInvite(r, BIA))).toBe('LFG_INVITE_GONE');
    const requested = joinRoster(roster({ visibility: 'closed' }), BIA, 1).roster;
    expect(code(() => acceptInvite(requested, BIA))).toBe('LFG_INVITE_GONE');
  });
});

describe('kickFromRoster', () => {
  it('tira de vaga sem puxar ninguém; o host não sai', () => {
    const change = kickFromRoster(fullOpen(), ANA);
    expect(change.outcome).toBe('going');
    expect(change.seated).toEqual([]);
    expect(freeSlots(change.roster)).toBe(1);
    expect(code(() => kickFromRoster(fullOpen(), HOST))).toBe('LFG_HOST_CANNOT_LEAVE');
    expect(code(() => kickFromRoster(fullOpen(), DUDA))).toBe('LFG_NOT_IN');
  });

  it('também apaga convite pendente e pedido', () => {
    let r = roster({ visibility: 'closed' });
    r = inviteToRoster(r, [ANA], HOST, 1).roster;
    r = joinRoster(r, BIA, 2).roster;
    expect(kickFromRoster(r, ANA).outcome).toBe('invited');
    expect(kickFromRoster(r, BIA).outcome).toBe('requested');
    expect(invitedEntries(kickFromRoster(r, ANA).roster)).toEqual([]);
  });
});

describe('setRosterSlots', () => {
  it('subir não senta pedido pendente', () => {
    let r = roster({ visibility: 'closed', slots: 2 });
    r = joinRoster(r, ANA, 1).roster;
    const change = setRosterSlots(r, 4);
    expect(change.roster.slots).toBe(4);
    expect(change.seated).toEqual([]);
    expect(entryOf(change.roster, ANA)?.status).toBe('requested');
  });

  it('não baixa abaixo de quem tem vaga nem sai da faixa', () => {
    let r = roster({ slots: 4 });
    r = joinRoster(r, ANA, 1).roster;
    r = joinRoster(r, BIA, 2).roster;
    expect(code(() => setRosterSlots(r, 2))).toBe('LFG_SLOTS_BELOW_SEATED');
    expect(setRosterSlots(r, 3).roster.slots).toBe(3);
    expect(code(() => setRosterSlots(r, 11))).toBe('LFG_SLOTS_RANGE');
    expect(code(() => setRosterSlots(r, 1))).toBe('LFG_SLOTS_RANGE');
    expect(code(() => setRosterSlots(r, 3.5))).toBe('LFG_SLOTS_RANGE');
  });
});

describe('setRosterVisibility', () => {
  it('pública aceita os pedidos na ordem: com vaga senta, sem vaga é recusado', () => {
    let r = roster({ visibility: 'closed', slots: 2 });
    r = joinRoster(r, BIA, 2).roster;
    r = joinRoster(r, ANA, 1).roster;
    const change = setRosterVisibility(r, 'open');
    expect(change.seated).toEqual([ANA]);
    expect(change.refused).toEqual([BIA]);
    expect(change.roster.visibility).toBe('open');
    expect(requestedEntries(change.roster)).toEqual([]);
    expect(entryOf(change.roster, BIA)).toBeUndefined();
  });

  it('convites pendentes seguem valendo nos dois sentidos', () => {
    let r = inviteToRoster(roster({ visibility: 'closed' }), [ANA], HOST, 1).roster;
    r = setRosterVisibility(r, 'open').roster;
    expect(entryOf(r, ANA)?.status).toBe('invited');
    r = setRosterVisibility(r, 'closed').roster;
    expect(entryOf(r, ANA)?.status).toBe('invited');
  });

  it('privada não mexe em quem já está', () => {
    const r = joinRoster(roster(), ANA, 1).roster;
    const change = setRosterVisibility(r, 'closed');
    expect(change.roster.visibility).toBe('closed');
    expect(entryOf(change.roster, ANA)?.status).toBe('going');
    expect(change.seated).toEqual([]);
    expect(change.refused).toEqual([]);
  });
});
