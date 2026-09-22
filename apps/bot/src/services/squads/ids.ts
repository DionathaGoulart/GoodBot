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
/** O voto de um membro sobre quem quer entrar. */
export type SquadRequestAction = 'for' | 'against';
/** A resposta do candidato ao convite. */
export type SquadInviteAction = 'accept' | 'pass';
export type SquadSessionAction = 'going' | 'notgoing' | 'cancel' | 'repeat' | 'reschedule';
const SESSION_ACTIONS: readonly string[] = ['going', 'notgoing', 'cancel', 'repeat', 'reschedule'];
/**
 * `accept` e `decline` são os botões do pedido antigo ("basta um aceite"),
 * ainda no ar nos canais dos squads: viram voto, e a próxima edição da
 * mensagem já troca os botões.
 */
const REQUEST_ACTIONS: ReadonlyMap<string, SquadRequestAction> = new Map([
  ['for', 'for'],
  ['against', 'against'],
  ['accept', 'for'],
  ['decline', 'against'],
]);
export type SquadStatusAction = 'searching' | 'paused';

export type SquadCustomId =
  | { kind: 'proposal'; action: SquadProposalAction; proposalId: string }
  | { kind: 'request'; action: SquadRequestAction; requestId: string }
  | { kind: 'invite'; action: SquadInviteAction; requestId: string }
  | { kind: 'invite-pick'; squadId: string }
  | { kind: 'invite-user'; squadId: string }
  | { kind: 'session'; action: SquadSessionAction; sessionId: number }
  | { kind: 'call'; sessionId: number }
  | { kind: 'guest-pick'; sessionId: number }
  | { kind: 'guest-user'; sessionId: number }
  | { kind: 'call-next'; squadId: string }
  | { kind: 'enter'; sessionId: number }
  | { kind: 'bora-open'; squadId: string }
  | { kind: 'bora-modal'; squadId: string }
  | { kind: 'reschedule-modal'; sessionId: number }
  | { kind: 'rename-open'; squadId: string }
  | { kind: 'rename-modal'; squadId: string }
  | { kind: 'stats'; squadId: string }
  | { kind: 'search'; gameId: string }
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

/** A FAVOR / CONTRA, na votação do canal do squad. */
export function requestButtonId(action: SquadRequestAction, requestId: string): string {
  return build('request', action, assertUuid(requestId, 'requestId'));
}

/** ENTRAR / PASSO, no convite da thread privada do candidato. */
export function inviteButtonId(action: SquadInviteAction, requestId: string): string {
  return build('invite', action, assertUuid(requestId, 'requestId'));
}

/** CONVIDAR, no guia do squad: abre a escolha de quem convidar. */
export function invitePickButtonId(squadId: string): string {
  return build('invite', 'pick', assertUuid(squadId, 'squadId'));
}

/** O select de pessoa da mensagem efêmera do CONVIDAR. */
export function inviteUserSelectId(squadId: string): string {
  return build('invite', 'user', assertUuid(squadId, 'squadId'));
}

function assertSessionId(sessionId: number): string {
  if (!Number.isSafeInteger(sessionId) || sessionId < 1) {
    throw new RangeError(`sessionId inválido para custom_id: ${String(sessionId)}`);
  }
  return String(sessionId);
}

export function sessionButtonId(action: SquadSessionAction, sessionId: number): string {
  return build('session', action, assertSessionId(sessionId));
}

/** CHAMAR GENTE, na mensagem da jogatina: posta esta jogatina no canal de busca. */
export function callButtonId(sessionId: number): string {
  return build('call', 'session', assertSessionId(sessionId));
}

/** CHAMAR GENTE, no guia do squad: chama gente para a próxima jogatina com lugar. */
export function callNextButtonId(squadId: string): string {
  return build('call', 'next', assertUuid(squadId, 'squadId'));
}

/** TRAZER CONVIDADO, na mensagem da jogatina: abre a escolha de quem trazer. */
export function guestPickButtonId(sessionId: number): string {
  return build('guest', 'pick', assertSessionId(sessionId));
}

/** O select de pessoa da mensagem efêmera do TRAZER CONVIDADO. */
export function guestUserSelectId(sessionId: number): string {
  return build('guest', 'user', assertSessionId(sessionId));
}

/** ENTRAR, na chamada pública do canal de busca: pede para entrar no squad da jogatina. */
export function enterButtonId(sessionId: number): string {
  return build('enter', assertSessionId(sessionId));
}

/** BORA, no guia do squad: abre o modal com o "quando". */
export function boraButtonId(squadId: string): string {
  return build('bora', 'open', assertUuid(squadId, 'squadId'));
}

export function boraModalId(squadId: string): string {
  return build('bora', 'modal', assertUuid(squadId, 'squadId'));
}

/** O modal do REMARCAR; o botão é `sessionButtonId('reschedule', id)`. */
export function rescheduleModalId(sessionId: number): string {
  return build('reschedule', 'modal', assertSessionId(sessionId));
}

/** RENOMEAR, no guia do squad: abre o modal com o nome atual. */
export function renameButtonId(squadId: string): string {
  return build('rename', 'open', assertUuid(squadId, 'squadId'));
}

export function renameModalId(squadId: string): string {
  return build('rename', 'modal', assertUuid(squadId, 'squadId'));
}

/** NÚMEROS, no guia do squad: o quanto e com quem o squad joga. */
export function statsButtonId(squadId: string): string {
  return build('stats', assertUuid(squadId, 'squadId'));
}

/** Squads com vaga num jogo, na mensagem de perfil salvo e no guia. */
export function searchButtonId(gameId: string): string {
  return build('search', assertUuid(gameId, 'gameId'));
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

/** `squad_sessions.id` de um `custom_id`; `null` fora do formato. */
function parseSessionId(value: string | undefined): number | null {
  if (!value || !SESSION_ID_RE.test(value)) return null;
  const sessionId = Number(value);
  return Number.isSafeInteger(sessionId) ? sessionId : null;
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
  const [, subject, second, third, fourth, fifth] = parts;
  const size = parts.length;

  switch (subject) {
    case 'proposal': {
      if (size !== 4 || (second !== 'accept' && second !== 'decline') || !isUuid(third)) {
        return null;
      }
      return { kind: 'proposal', action: second, proposalId: third };
    }
    case 'request': {
      if (size !== 4 || !second || !isUuid(third)) return null;
      const action = REQUEST_ACTIONS.get(second);
      return action ? { kind: 'request', action, requestId: third } : null;
    }
    case 'invite': {
      if (size !== 4 || !isUuid(third)) return null;
      switch (second) {
        case 'accept':
        case 'pass':
          return { kind: 'invite', action: second, requestId: third };
        case 'pick':
          return { kind: 'invite-pick', squadId: third };
        case 'user':
          return { kind: 'invite-user', squadId: third };
        default:
          return null;
      }
    }
    case 'session': {
      if (size !== 4 || !second || !SESSION_ACTIONS.includes(second)) return null;
      const sessionId = parseSessionId(third);
      return sessionId === null
        ? null
        : { kind: 'session', action: second as SquadSessionAction, sessionId };
    }
    case 'call': {
      if (size !== 4) return null;
      if (second === 'next') return isUuid(third) ? { kind: 'call-next', squadId: third } : null;
      if (second !== 'session') return null;
      const sessionId = parseSessionId(third);
      return sessionId === null ? null : { kind: 'call', sessionId };
    }
    case 'guest': {
      if (size !== 4 || (second !== 'pick' && second !== 'user')) return null;
      const sessionId = parseSessionId(third);
      return sessionId === null ? null : { kind: `guest-${second}`, sessionId };
    }
    case 'enter': {
      const sessionId = size === 3 ? parseSessionId(second) : null;
      return sessionId === null ? null : { kind: 'enter', sessionId };
    }
    case 'reschedule': {
      const sessionId = size === 4 && second === 'modal' ? parseSessionId(third) : null;
      return sessionId === null ? null : { kind: 'reschedule-modal', sessionId };
    }
    case 'bora':
    case 'rename': {
      if (size !== 4 || !isUuid(third)) return null;
      if (second === 'open') return { kind: `${subject}-open`, squadId: third };
      if (second === 'modal') return { kind: `${subject}-modal`, squadId: third };
      return null;
    }
    case 'search':
      return size === 3 && isUuid(second) ? { kind: 'search', gameId: second } : null;
    case 'keep':
    case 'leave':
    case 'join':
    case 'stats':
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
