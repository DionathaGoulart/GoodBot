import { LFG_INVITE_MAX_PER_BATCH, LFG_MAX_SLOTS, LFG_MIN_SLOTS } from '../constants';
import { UserFacingError } from '../errors';

import type { LfgMemberStatus, LfgVisibility } from '../constants';

/**
 * A lista de uma jogatina ou de um card (PRD §5.11) como dado puro: quem
 * marcou, quem vai, quem pediu vaga e quem foi convidado. As regras daqui não
 * sabem de banco nem de Discord. O bot lê a lista com a linha travada, aplica
 * uma regra e grava a diferença; o que a regra devolve em `seated` e `refused`
 * é quem avisar.
 *
 * `slots` conta o host. Vaga ocupada é `host` ou `going`. Não há fila: com a
 * lista cheia, entrar recusa, e quem quer tenta de novo quando alguém sair.
 */
export interface RosterEntry {
  userId: string;
  status: LfgMemberStatus;
  /** Epoch em ms. Decide a ordem dos pedidos. */
  joinedAt: number;
  /** Quem convidou, só em `invited` (e em quem entrou por convite). */
  invitedBy?: string | null;
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
  /** Quem perdeu o pedido por falta de vaga, fora quem agiu: avisar por DM. */
  refused: string[];
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

export function requestedEntries(roster: Roster): RosterEntry[] {
  return roster.entries.filter((entry) => entry.status === 'requested').sort(byArrival);
}

export function invitedEntries(roster: Roster): RosterEntry[] {
  return roster.entries.filter((entry) => entry.status === 'invited').sort(byArrival);
}

export function freeSlots(roster: Roster): number {
  return Math.max(0, roster.slots - roster.entries.filter(isSeated).length);
}

export function isRosterFull(roster: Roster): boolean {
  return freeSlots(roster) === 0;
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

function change<O>(roster: Roster, outcome: O): RosterChange<O> {
  return { roster, outcome, seated: [], refused: [] };
}

function notIn(): UserFacingError {
  return new UserFacingError('Você não está nessa jogatina.', { code: 'LFG_NOT_IN' });
}

function full(message = 'Lotou. Tente de novo quando alguém sair.'): UserFacingError {
  return new UserFacingError(message, { code: 'LFG_FULL' });
}

const ALREADY_IN: Record<Exclude<LfgMemberStatus, 'invited'>, string> = {
  host: 'Você marcou essa jogatina: já está dentro.',
  going: 'Você já está na lista dessa jogatina.',
  requested: 'Seu pedido já está com quem marcou. Espere a resposta.',
};

export type JoinOutcome = 'going' | 'requested';

/**
 * VOU (pública) ou PEDIR VAGA (privada). Pública com vaga senta; privada vira
 * pedido, com vaga ou sem, porque quem decide é o host. Lotada recusa nos dois
 * casos: pedir vaga numa lista cheia só daria ao host um pedido que ele não
 * pode aceitar. Quem tinha convite pendente e clica para entrar está aceitando
 * o convite, e senta sem passar pelo host.
 */
export function joinRoster(roster: Roster, userId: string, now: number): RosterChange<JoinOutcome> {
  const existing = entryOf(roster, userId);
  if (existing?.status === 'invited') {
    return acceptInvite(roster, userId);
  }
  if (existing) {
    throw new UserFacingError(ALREADY_IN[existing.status], { code: 'LFG_ALREADY_IN' });
  }
  if (isRosterFull(roster)) throw full();
  const outcome: JoinOutcome = roster.visibility === 'closed' ? 'requested' : 'going';
  return change(
    { ...roster, entries: [...roster.entries, { userId, status: outcome, joinedAt: now }] },
    outcome,
  );
}

/**
 * SAIR: da lista, do pedido ou do convite. Quem marcou não sai, cancela: sem
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
  return change(without(roster, userId), existing.status);
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

/** ACEITAR um pedido: com vaga senta; lotada recusa, e o host sobe as vagas antes. */
export function acceptRequest(roster: Roster, userId: string): RosterChange<'going'> {
  requestOf(roster, userId);
  if (isRosterFull(roster)) {
    throw full('Lotou. Suba as vagas em GERENCIAR antes de aceitar.');
  }
  return change(withStatus(roster, userId, 'going'), 'going');
}

/** RECUSAR um pedido: ele some, e a pessoa pode pedir de novo. */
export function rejectRequest(roster: Roster, userId: string): RosterChange<'rejected'> {
  requestOf(roster, userId);
  return change(without(roster, userId), 'rejected');
}

export interface InviteOutcome {
  /** Quem virou `invited` agora: mandar DM. */
  invited: string[];
  /** Quem já estava na lista (em qualquer papel): nada a fazer. */
  skipped: string[];
}

/**
 * CONVIDAR: cada um vira `invited`, com `invitedBy`. Quem já está na lista
 * (vai, pediu ou já foi convidado) é pulado. Convidar numa lista cheia vale:
 * o convite fica pendente, e quem aceitar só entra se houver vaga.
 */
export function inviteToRoster(
  roster: Roster,
  userIds: readonly string[],
  invitedBy: string,
  now: number,
): RosterChange<InviteOutcome> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) {
    throw new UserFacingError('Escolha pelo menos uma pessoa para convidar.', {
      code: 'LFG_INVITE_EMPTY',
    });
  }
  if (unique.length > LFG_INVITE_MAX_PER_BATCH) {
    throw new UserFacingError(
      `Dá para convidar até ${String(LFG_INVITE_MAX_PER_BATCH)} pessoas de uma vez.`,
      { code: 'LFG_INVITE_TOO_MANY' },
    );
  }
  const invited: string[] = [];
  const skipped: string[] = [];
  const added: RosterEntry[] = [];
  for (const userId of unique) {
    if (entryOf(roster, userId)) {
      skipped.push(userId);
      continue;
    }
    invited.push(userId);
    added.push({ userId, status: 'invited', joinedAt: now, invitedBy });
  }
  return change({ ...roster, entries: [...roster.entries, ...added] }, { invited, skipped });
}

function inviteOf(roster: Roster, userId: string): RosterEntry {
  const existing = entryOf(roster, userId);
  if (existing?.status !== 'invited') {
    throw new UserFacingError('Esse convite já foi respondido ou retirado.', {
      code: 'LFG_INVITE_GONE',
    });
  }
  return existing;
}

/** ACEITAR um convite: entra direto em "vão"; lotada recusa. */
export function acceptInvite(roster: Roster, userId: string): RosterChange<'going'> {
  inviteOf(roster, userId);
  if (isRosterFull(roster)) throw full('Lotou antes de você aceitar. Fale com quem te convidou.');
  return change(withStatus(roster, userId, 'going'), 'going');
}

/** RECUSAR um convite: a pessoa sai da lista. */
export function declineInvite(roster: Roster, userId: string): RosterChange<'declined'> {
  inviteOf(roster, userId);
  return change(without(roster, userId), 'declined');
}

/**
 * TIRAR ALGUÉM: o host ou a staff. Tira de qualquer papel, convite pendente
 * inclusive. O host nunca é tirado.
 */
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
  return change(without(roster, userId), existing.status);
}

/**
 * VAGAS: baixar só até quem já tem vaga, porque tirar a vaga de alguém que
 * confirmou é decisão do host, não efeito colateral. Subir não senta ninguém:
 * pedido pendente continua esperando o host.
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
  return change({ ...roster, slots }, slots);
}

/**
 * PÚBLICA / PRIVADA. Virar privada não mexe em ninguém. Virar pública aceita
 * os pedidos pendentes na ordem em que chegaram: com vaga sentam, sem vaga são
 * recusados (e avisados). Convites pendentes seguem valendo nos dois sentidos.
 */
export function setRosterVisibility(
  roster: Roster,
  visibility: LfgVisibility,
): RosterChange<LfgVisibility> {
  if (roster.visibility === visibility || visibility === 'closed') {
    return change({ ...roster, visibility }, visibility);
  }
  let next: Roster = { ...roster, visibility };
  const seated: string[] = [];
  const refused: string[] = [];
  for (const entry of requestedEntries(roster)) {
    if (isRosterFull(next)) {
      next = without(next, entry.userId);
      refused.push(entry.userId);
    } else {
      next = withStatus(next, entry.userId, 'going');
      seated.push(entry.userId);
    }
  }
  return { roster: next, outcome: visibility, seated, refused };
}
