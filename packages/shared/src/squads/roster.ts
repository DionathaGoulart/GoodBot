import { LFG_MAX_SLOTS, LFG_MIN_SLOTS } from '../constants';
import { UserFacingError } from '../errors';

import type { LfgMemberStatus, LfgVisibility } from '../constants';

/**
 * A lista de uma jogatina da agenda (PRD §5.11) como dado puro: quem marcou,
 * quem vai, quem espera e quem pediu. As regras daqui não sabem de banco nem
 * de Discord. O bot lê a lista com a jogatina travada, aplica uma regra e grava
 * a diferença; o que a regra devolve em `seated` e `queued` é quem avisar.
 *
 * `slots` conta o host. Vaga ocupada é `host` ou `going`; `waiting` é a fila,
 * na ordem de `joinedAt`; `requested` é quem pediu numa fechada e ainda não
 * ouviu o host.
 */
export interface RosterEntry {
  userId: string;
  status: LfgMemberStatus;
  /** Epoch em ms. Decide a ordem da fila. */
  joinedAt: number;
}

export interface Roster {
  hostId: string;
  slots: number;
  visibility: LfgVisibility;
  entries: readonly RosterEntry[];
}

export interface RosterChange<O> {
  roster: Roster;
  /** O que aconteceu com quem agiu (ou com quem foi alvo da ação). */
  outcome: O;
  /** Quem ganhou vaga por causa da mudança, fora quem agiu: avisar por DM. */
  seated: string[];
  /** Quem foi para a fila por causa da mudança, fora quem agiu: avisar por DM. */
  queued: string[];
}

function isSeated(entry: RosterEntry): boolean {
  return entry.status === 'host' || entry.status === 'going';
}

function byArrival(a: RosterEntry, b: RosterEntry): number {
  return a.joinedAt - b.joinedAt || a.userId.localeCompare(b.userId);
}

export function entryOf(roster: Roster, userId: string): RosterEntry | undefined {
  return roster.entries.find((entry) => entry.userId === userId);
}

/** Quem ocupa vaga, o host primeiro e o resto por ordem de chegada. */
export function seatedEntries(roster: Roster): RosterEntry[] {
  return roster.entries
    .filter(isSeated)
    .sort((a, b) => Number(b.status === 'host') - Number(a.status === 'host') || byArrival(a, b));
}

export function waitingEntries(roster: Roster): RosterEntry[] {
  return roster.entries.filter((entry) => entry.status === 'waiting').sort(byArrival);
}

export function requestedEntries(roster: Roster): RosterEntry[] {
  return roster.entries.filter((entry) => entry.status === 'requested').sort(byArrival);
}

export function freeSlots(roster: Roster): number {
  return Math.max(0, roster.slots - roster.entries.filter(isSeated).length);
}

function withStatus(roster: Roster, userId: string, status: LfgMemberStatus): Roster {
  return {
    ...roster,
    entries: roster.entries.map((entry) =>
      entry.userId === userId ? { ...entry, status } : entry,
    ),
  };
}

function without(roster: Roster, userId: string): Roster {
  return { ...roster, entries: roster.entries.filter((entry) => entry.userId !== userId) };
}

/** Vaga livre puxa a fila, na ordem de chegada. Devolve quem sentou. */
function fill(roster: Roster): { roster: Roster; seated: string[] } {
  let next = roster;
  const seated: string[] = [];
  for (const entry of waitingEntries(roster)) {
    if (freeSlots(next) === 0) break;
    next = withStatus(next, entry.userId, 'going');
    seated.push(entry.userId);
  }
  return { roster: next, seated };
}

function notIn(): UserFacingError {
  return new UserFacingError('Você não está nessa jogatina.', { code: 'LFG_NOT_IN' });
}

const ALREADY_IN: Record<LfgMemberStatus, string> = {
  host: 'Você marcou essa jogatina: já está dentro.',
  going: 'Você já está na lista dessa jogatina.',
  waiting: 'Você já está na fila de espera dessa jogatina.',
  requested: 'Seu pedido já está com quem marcou. Espere a resposta.',
};

export type JoinOutcome = 'going' | 'waiting' | 'requested';

/**
 * VOU (aberta) ou PEDIR VAGA (fechada). Aberta com vaga senta; aberta lotada
 * vai para a fila; fechada sempre vira pedido, lotada ou não.
 */
export function joinRoster(
  roster: Roster,
  userId: string,
  now: number,
): RosterChange<JoinOutcome> {
  const existing = entryOf(roster, userId);
  if (existing) {
    throw new UserFacingError(ALREADY_IN[existing.status], { code: 'LFG_ALREADY_IN' });
  }
  const outcome: JoinOutcome =
    roster.visibility === 'closed' ? 'requested' : freeSlots(roster) > 0 ? 'going' : 'waiting';
  return {
    roster: {
      ...roster,
      entries: [...roster.entries, { userId, status: outcome, joinedAt: now }],
    },
    outcome,
    seated: [],
    queued: [],
  };
}

/**
 * SAIR: da lista, da fila ou do pedido. Quem marcou não sai, cancela: sem
 * host a jogatina não tem quem aprove nem quem gerencie.
 */
export function leaveRoster(roster: Roster, userId: string): RosterChange<LfgMemberStatus> {
  const existing = entryOf(roster, userId);
  if (!existing) throw notIn();
  if (existing.status === 'host') {
    throw new UserFacingError(
      'Quem marcou não sai da própria jogatina. Para desistir, cancele em GERENCIAR.',
      { code: 'LFG_HOST_CANNOT_LEAVE' },
    );
  }
  const filled = fill(without(roster, userId));
  return { roster: filled.roster, outcome: existing.status, seated: filled.seated, queued: [] };
}

function requestOf(roster: Roster, userId: string): RosterEntry {
  const existing = entryOf(roster, userId);
  if (existing?.status !== 'requested') {
    throw new UserFacingError('Esse pedido já foi respondido ou retirado.', {
      code: 'LFG_REQUEST_GONE',
    });
  }
  return existing;
}

/** ACEITAR: com vaga senta, lotada vai para a fila na ordem em que pediu. */
export function acceptRequest(
  roster: Roster,
  userId: string,
): RosterChange<'going' | 'waiting'> {
  requestOf(roster, userId);
  const outcome = freeSlots(roster) > 0 ? 'going' : 'waiting';
  return {
    roster: withStatus(roster, userId, outcome),
    outcome,
    seated: [],
    queued: [],
  };
}

/** RECUSAR: o pedido some, e a pessoa pode pedir de novo. */
export function rejectRequest(roster: Roster, userId: string): RosterChange<'rejected'> {
  requestOf(roster, userId);
  return { roster: without(roster, userId), outcome: 'rejected', seated: [], queued: [] };
}

/** TIRAR ALGUÉM: o host ou a staff. O host nunca é tirado. */
export function kickFromRoster(roster: Roster, userId: string): RosterChange<LfgMemberStatus> {
  const existing = entryOf(roster, userId);
  if (!existing) {
    throw new UserFacingError('Essa pessoa não está na jogatina.', { code: 'LFG_NOT_IN' });
  }
  if (existing.status === 'host') {
    throw new UserFacingError('Quem marcou não sai da lista. Cancele a jogatina.', {
      code: 'LFG_HOST_CANNOT_LEAVE',
    });
  }
  const filled = fill(without(roster, userId));
  return { roster: filled.roster, outcome: existing.status, seated: filled.seated, queued: [] };
}

/**
 * VAGAS: subir puxa a fila; baixar só até quem já tem vaga, porque tirar a
 * vaga de alguém que confirmou é decisão do host, não efeito colateral.
 */
export function setRosterSlots(roster: Roster, slots: number): RosterChange<number> {
  if (!Number.isInteger(slots) || slots < LFG_MIN_SLOTS || slots > LFG_MAX_SLOTS) {
    throw new UserFacingError(
      `As vagas vão de ${String(LFG_MIN_SLOTS)} a ${String(LFG_MAX_SLOTS)}, contando você.`,
      { code: 'LFG_SLOTS_RANGE' },
    );
  }
  const seated = roster.entries.filter(isSeated).length;
  if (slots < seated) {
    throw new UserFacingError(
      `Já tem ${String(seated)} pessoas com vaga. Tire alguém antes de baixar para ${String(slots)}.`,
      { code: 'LFG_SLOTS_BELOW_SEATED' },
    );
  }
  const filled = fill({ ...roster, slots });
  return { roster: filled.roster, outcome: slots, seated: filled.seated, queued: [] };
}

/**
 * ABRIR / FECHAR. Fechar não mexe em quem já está. Abrir aceita todos os
 * pedidos pendentes, na ordem em que chegaram: com vaga sentam, sem vaga vão
 * para a fila.
 */
export function setRosterVisibility(
  roster: Roster,
  visibility: LfgVisibility,
): RosterChange<LfgVisibility> {
  if (roster.visibility === visibility || visibility === 'closed') {
    return { roster: { ...roster, visibility }, outcome: visibility, seated: [], queued: [] };
  }
  let next: Roster = { ...roster, visibility };
  const seated: string[] = [];
  const queued: string[] = [];
  for (const entry of requestedEntries(roster)) {
    if (freeSlots(next) > 0) {
      next = withStatus(next, entry.userId, 'going');
      seated.push(entry.userId);
    } else {
      next = withStatus(next, entry.userId, 'waiting');
      queued.push(entry.userId);
    }
  }
  return { roster: next, outcome: visibility, seated, queued };
}
