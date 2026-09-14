/**
 * `custom_id` de todo componente do módulo `squads`. Formato
 * `squad:<assunto>:<ação>:<id>`: o prefixo roteia (ver `interactions/index.ts`)
 * e o resto é lido aqui, num lugar só, para o builder e o parser nunca
 * divergirem. O Discord aceita até 100 caracteres; o maior daqui tem 59.
 */

export const SQUAD_PREFIX = 'squad';

/** Teto do Discord para `custom_id`. */
export const MAX_CUSTOM_ID_LENGTH = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `squad_sessions.id` é `bigserial` lido como `number`. */
const SESSION_ID_RE = /^[1-9]\d{0,15}$/;

export type SquadProposalAction = 'accept' | 'decline';
export type SquadRequestAction = 'accept' | 'decline';
export type SquadSessionAction = 'going' | 'notgoing';

export type SquadCustomId =
  | { kind: 'proposal'; action: SquadProposalAction; proposalId: string }
  | { kind: 'request'; action: SquadRequestAction; requestId: string }
  | { kind: 'session'; action: SquadSessionAction; sessionId: number }
  | { kind: 'keep'; squadId: string }
  | { kind: 'leave'; squadId: string }
  | { kind: 'profile-start'; gameId: string };

function assertUuid(value: string, what: string): string {
  if (!UUID_RE.test(value)) throw new RangeError(`${what} inválido para custom_id: ${value}`);
  return value;
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

export function profileStartButtonId(gameId: string): string {
  return build('profile', 'start', assertUuid(gameId, 'gameId'));
}

/**
 * Lê um `custom_id` do módulo. `null` para qualquer coisa fora do formato:
 * mensagem antiga, prefixo de outro módulo ou id adulterado. Quem roteia
 * responde "botão desconhecido" em vez de consultar o banco com lixo.
 */
export function parseSquadCustomId(customId: string): SquadCustomId | null {
  if (customId.length > MAX_CUSTOM_ID_LENGTH) return null;
  const parts = customId.split(':');
  if (parts[0] !== SQUAD_PREFIX) return null;
  const [, subject, second, third, ...rest] = parts;
  if (rest.length > 0) return null;

  switch (subject) {
    case 'proposal':
    case 'request': {
      if ((second !== 'accept' && second !== 'decline') || !third || !UUID_RE.test(third)) {
        return null;
      }
      return subject === 'proposal'
        ? { kind: 'proposal', action: second, proposalId: third }
        : { kind: 'request', action: second, requestId: third };
    }
    case 'session': {
      if ((second !== 'going' && second !== 'notgoing') || !third || !SESSION_ID_RE.test(third)) {
        return null;
      }
      const sessionId = Number(third);
      return Number.isSafeInteger(sessionId)
        ? { kind: 'session', action: second, sessionId }
        : null;
    }
    case 'keep':
    case 'leave': {
      if (third !== undefined || !second || !UUID_RE.test(second)) return null;
      return { kind: subject, squadId: second };
    }
    case 'profile': {
      if (second !== 'start' || !third || !UUID_RE.test(third)) return null;
      return { kind: 'profile-start', gameId: third };
    }
    default:
      return null;
  }
}
