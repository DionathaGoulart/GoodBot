import { describe, expect, it } from 'vitest';

import { UserFacingError } from '../errors';
import {
  acceptRequest,
  entryOf,
  freeSlots,
  joinRoster,
  kickFromRoster,
  leaveRoster,
  rejectRequest,
  requestedEntries,
  seatedEntries,
  setRosterSlots,
  setRosterVisibility,
  waitingEntries,
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

describe('joinRoster', () => {
  it('aberta com vaga senta, lotada vai para a fila', () => {
    let r = roster();
    r = joinRoster(r, ANA, 1).roster;
    const full = joinRoster(r, BIA, 2);
    expect(full.outcome).toBe('going');
    expect(freeSlots(full.roster)).toBe(0);
    const late = joinRoster(full.roster, CAIO, 3);
    expect(late.outcome).toBe('waiting');
    expect(ids(waitingEntries(late.roster))).toEqual([CAIO]);
  });

  it('fechada sempre vira pedido, com vaga ou sem', () => {
    const change = joinRoster(roster({ visibility: 'closed' }), ANA, 1);
    expect(change.outcome).toBe('requested');
    expect(ids(requestedEntries(change.roster))).toEqual([ANA]);
    expect(freeSlots(change.roster)).toBe(2);
  });

  it('não entra duas vezes, nem o host', () => {
    const r = joinRoster(roster(), ANA, 1).roster;
    expect(code(() => joinRoster(r, ANA, 2))).toBe('LFG_ALREADY_IN');
    expect(code(() => joinRoster(r, HOST, 2))).toBe('LFG_ALREADY_IN');
  });
});

describe('leaveRoster', () => {
  it('quem sai da vaga puxa o primeiro da fila', () => {
    let r = roster({ slots: 2 });
    r = joinRoster(r, ANA, 1).roster;
    r = joinRoster(r, BIA, 2).roster;
    r = joinRoster(r, CAIO, 3).roster;
    const change = leaveRoster(r, ANA);
    expect(change.outcome).toBe('going');
    expect(change.seated).toEqual([BIA]);
    expect(ids(seatedEntries(change.roster))).toEqual([HOST, BIA]);
    expect(ids(waitingEntries(change.roster))).toEqual([CAIO]);
  });

  it('quem sai da fila não puxa ninguém', () => {
    let r = roster({ slots: 2 });
    r = joinRoster(r, ANA, 1).roster;
    r = joinRoster(r, BIA, 2).roster;
    const change = leaveRoster(r, BIA);
    expect(change.outcome).toBe('waiting');
    expect(change.seated).toEqual([]);
  });

  it('o host não sai e quem não está recebe erro', () => {
    expect(code(() => leaveRoster(roster(), HOST))).toBe('LFG_HOST_CANNOT_LEAVE');
    expect(code(() => leaveRoster(roster(), ANA))).toBe('LFG_NOT_IN');
  });
});

describe('pedido numa fechada', () => {
  it('aceito com vaga senta; aceito lotado vai para a fila', () => {
    let r = roster({ visibility: 'closed', slots: 2 });
    r = joinRoster(r, ANA, 1).roster;
    r = joinRoster(r, BIA, 2).roster;
    const first = acceptRequest(r, ANA);
    expect(first.outcome).toBe('going');
    const second = acceptRequest(first.roster, BIA);
    expect(second.outcome).toBe('waiting');
    expect(entryOf(second.roster, BIA)?.status).toBe('waiting');
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

  it('quem pediu pode desistir sem mexer nas vagas', () => {
    const r = joinRoster(roster({ visibility: 'closed' }), ANA, 1).roster;
    const change = leaveRoster(r, ANA);
    expect(change.outcome).toBe('requested');
    expect(change.roster.entries).toHaveLength(1);
  });
});

describe('kickFromRoster', () => {
  it('tira e puxa a fila; o host não sai', () => {
    let r = roster({ slots: 2 });
    r = joinRoster(r, ANA, 1).roster;
    r = joinRoster(r, BIA, 2).roster;
    const change = kickFromRoster(r, ANA);
    expect(change.seated).toEqual([BIA]);
    expect(code(() => kickFromRoster(r, HOST))).toBe('LFG_HOST_CANNOT_LEAVE');
    expect(code(() => kickFromRoster(r, DUDA))).toBe('LFG_NOT_IN');
  });
});

describe('setRosterSlots', () => {
  it('subir puxa a fila na ordem de chegada', () => {
    let r = roster({ slots: 2 });
    r = joinRoster(r, ANA, 1).roster;
    r = joinRoster(r, CAIO, 3).roster;
    r = joinRoster(r, BIA, 2).roster;
    const change = setRosterSlots(r, 4);
    expect(change.seated).toEqual([BIA, CAIO]);
    expect(freeSlots(change.roster)).toBe(0);
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
  it('abrir aceita os pedidos: com vaga senta, sem vaga vai para a fila', () => {
    let r = roster({ visibility: 'closed', slots: 2 });
    r = joinRoster(r, BIA, 2).roster;
    r = joinRoster(r, ANA, 1).roster;
    const change = setRosterVisibility(r, 'open');
    expect(change.seated).toEqual([ANA]);
    expect(change.queued).toEqual([BIA]);
    expect(change.roster.visibility).toBe('open');
    expect(requestedEntries(change.roster)).toEqual([]);
  });

  it('fechar não mexe em quem já está', () => {
    let r = roster();
    r = joinRoster(r, ANA, 1).roster;
    const change = setRosterVisibility(r, 'closed');
    expect(change.roster.visibility).toBe('closed');
    expect(entryOf(change.roster, ANA)?.status).toBe('going');
    expect(change.seated).toEqual([]);
  });
});
