import { SQUAD_AVAILABILITY_MAX, SQUAD_BLOCKS } from '@goodbot/shared';

/**
 * `custom_id` de todo componente do módulo `squads`. Formato
 * `squad:<assunto>:<ação>:<id>`: o prefixo roteia (ver `interactions/index.ts`)
 * e o resto é lido aqui, num lugar só, para o builder e o parser nunca
 * divergirem. O Discord aceita até 100 caracteres; o maior daqui tem 63.
 */

export const SQUAD_PREFIX = 'squad';

/** Teto do Discord para `custom_id`. */
export const MAX_CUSTOM_ID_LENGTH = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `squad_sessions.id` é `bigserial` lido como `number`. */
const SESSION_ID_RE = /^[1-9]\d{0,15}$/;
/** Máscara da grade em decimal, sem zero à esquerda: 28 bits cabem em 9 dígitos. */
const MASK_RE = /^(0|[1-9]\d{0,8})$/;
const BLOCK_RE = /^\d$/;

export type SquadProposalAction = 'accept' | 'decline';
export type SquadRequestAction = 'accept' | 'decline';
export type SquadSessionAction = 'going' | 'notgoing';
export type SquadStatusAction = 'searching' | 'paused';

export type SquadCustomId =
  | { kind: 'proposal'; action: SquadProposalAction; proposalId: string }
  | { kind: 'request'; action: SquadRequestAction; requestId: string }
  | { kind: 'session'; action: SquadSessionAction; sessionId: number }
  | { kind: 'keep'; squadId: string }
  | { kind: 'leave'; squadId: string }
  | { kind: 'leave-confirm'; squadId: string }
  | { kind: 'join'; squadId: string }
  | { kind: 'profile-start'; gameId: string }
  | { kind: 'profile-modal'; gameId: string }
  | { kind: 'grid-set'; gameId: string; block: number; mask: number }
  | { kind: 'grid-save'; gameId: string; mask: number }
  | { kind: 'status'; status: SquadStatusAction; gameId: string };

function assertUuid(value: string, what: string): string {
  if (!UUID_RE.test(value)) throw new RangeError(`${what} inválido para custom_id: ${value}`);
  return value;
}

function assertMask(mask: number): string {
  if (!Number.isInteger(mask) || mask < 0 || mask > SQUAD_AVAILABILITY_MAX) {
    throw new RangeError(`máscara inválida para custom_id: ${String(mask)}`);
  }
  return String(mask);
}

function build(...parts: string[]): string {
  const id = [SQUAD_PREFIX, ...parts].join(':');
  if (id.length > MAX_CUSTOM_ID_LENGTH) throw new RangeError(`custom_id longo demais: ${id}`);
  return id;
}

export function proposalButtonId(action: SquadProposalAction, proposalId: string): string {
  return build('proposal', action, assertUuid(proposalId, 'proposalId'));
}

export function requestButtonId(action: SquadRequestAction, requestId: string): string {
  return build('request', action, assertUuid(requestId, 'requestId'));
}

export function sessionButtonId(action: SquadSessionAction, sessionId: number): string {
  if (!Number.isSafeInteger(sessionId) || sessionId < 1) {
    throw new RangeError(`sessionId inválido para custom_id: ${String(sessionId)}`);
  }
  return build('session', action, String(sessionId));
}

export function keepButtonId(squadId: string): string {
  return build('keep', assertUuid(squadId, 'squadId'));
}

export function leaveButtonId(squadId: string): string {
  return build('leave', assertUuid(squadId, 'squadId'));
}

/** A confirmação do botão de sair: sair pode arquivar o squad, então não vai num clique só. */
export function confirmLeaveButtonId(squadId: string): string {
  return build('quit', assertUuid(squadId, 'squadId'));
}

/** "Pedir para entrar", na lista do `/squad procurar`. */
export function joinButtonId(squadId: string): string {
  return build('join', assertUuid(squadId, 'squadId'));
}

export function profileStartButtonId(gameId: string): string {
  return build('profile', 'start', assertUuid(gameId, 'gameId'));
}

export function profileModalId(gameId: string): string {
  return build('profile', 'modal', assertUuid(gameId, 'gameId'));
}

/**
 * Select de uma faixa da grade. A grade não guarda estado em lugar nenhum: a
 * máscara inteira viaja no `custom_id` de cada componente, e cada escolha
 * reescreve a mensagem com a máscara nova.
 */
export function gridSelectId(gameId: string, block: number, mask: number): string {
  if (!Number.isInteger(block) || block < 0 || block >= SQUAD_BLOCKS.length) {
    throw new RangeError(`faixa inválida para custom_id: ${String(block)}`);
  }
  return build('grid', 'set', String(block), assertUuid(gameId, 'gameId'), assertMask(mask));
}

export function gridSaveButtonId(gameId: string, mask: number): string {
  return build('grid', 'save', assertUuid(gameId, 'gameId'), assertMask(mask));
}

export function statusButtonId(status: SquadStatusAction, gameId: string): string {
  return build('status', status, assertUuid(gameId, 'gameId'));
}

function parseMask(value: string | undefined): number | null {
  if (!value || !MASK_RE.test(value)) return null;
  const mask = Number(value);
  return mask <= SQUAD_AVAILABILITY_MAX ? mask : null;
}

const isUuid = (value: string | undefined): value is string =>
  value !== undefined && UUID_RE.test(value);

/**
 * Lê um `custom_id` do módulo. `null` para qualquer coisa fora do formato:
 * mensagem antiga, prefixo de outro módulo ou id adulterado. Quem roteia
 * responde "botão desconhecido" em vez de consultar o banco com lixo.
 */
export function parseSquadCustomId(customId: string): SquadCustomId | null {
  if (customId.length > MAX_CUSTOM_ID_LENGTH) return null;
  const parts = customId.split(':');
  if (parts[0] !== SQUAD_PREFIX) return null;
  const [, subject, second, third, fourth, fifth] = parts;
  const size = parts.length;

  switch (subject) {
    case 'proposal':
    case 'request': {
      if (size !== 4 || (second !== 'accept' && second !== 'decline') || !isUuid(third)) {
        return null;
      }
      return subject === 'proposal'
        ? { kind: 'proposal', action: second, proposalId: third }
        : { kind: 'request', action: second, requestId: third };
    }
    case 'session': {
      if (size !== 4 || (second !== 'going' && second !== 'notgoing')) return null;
      if (!third || !SESSION_ID_RE.test(third)) return null;
      const sessionId = Number(third);
      return Number.isSafeInteger(sessionId)
        ? { kind: 'session', action: second, sessionId }
        : null;
    }
    case 'keep':
    case 'leave':
    case 'join':
    case 'quit': {
      if (size !== 3 || !isUuid(second)) return null;
      return { kind: subject === 'quit' ? 'leave-confirm' : subject, squadId: second };
    }
    case 'profile': {
      if (size !== 4 || !isUuid(third)) return null;
      if (second === 'start') return { kind: 'profile-start', gameId: third };
      if (second === 'modal') return { kind: 'profile-modal', gameId: third };
      return null;
    }
    case 'grid': {
      if (second === 'set') {
        if (size !== 6 || !third || !BLOCK_RE.test(third) || !isUuid(fourth)) return null;
        const block = Number(third);
        const mask = parseMask(fifth);
        if (block >= SQUAD_BLOCKS.length || mask === null) return null;
        return { kind: 'grid-set', gameId: fourth, block, mask };
      }
      if (second === 'save') {
        const mask = parseMask(fourth);
        if (size !== 5 || !isUuid(third) || mask === null) return null;
        return { kind: 'grid-save', gameId: third, mask };
      }
      return null;
    }
    case 'status': {
      if (size !== 4 || (second !== 'searching' && second !== 'paused') || !isUuid(third)) {
        return null;
      }
      return { kind: 'status', status: second, gameId: third };
    }
    default:
      return null;
  }
}
