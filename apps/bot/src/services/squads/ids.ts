/**
 * `custom_id` dos componentes do módulo `squads`. O prefixo `squad` roteia
 * (ver `interactions/index.ts`) e o resto é lido aqui, num lugar só, para o
 * builder e o parser nunca divergirem.
 *
 * - `squad:search` e `squad:optout`: os toggles, em mensagem de servidor.
 * - `squad:schedule`: o botão MARCAR JOGATINA e o modal que ele abre.
 * - `squad:vis:<open|closed>`: ABERTA ou FECHADA, logo depois do modal.
 * - `squad:a:<ação>:<sessionId>`: os botões da mensagem da jogatina na agenda.
 * - `squad:req:<ok|no>:<guildId>:<sessionId>:<userId>`: ACEITAR e RECUSAR um
 *   pedido de vaga. Vai na DM do host e, com a DM fechada, na thread; a DM não
 *   pertence a servidor nenhum, então a guild viaja no próprio `custom_id`.
 * - `squad:dm:<escolha>:<guildId>`: os botões do aviso automático, pelo mesmo
 *   motivo.
 */

import { LFG_VISIBILITIES } from '@goodbot/shared';

import type { LfgVisibility } from '@goodbot/shared';

export const SQUAD_PREFIX = 'squad';

const SNOWFLAKE_RE = /^\d{17,20}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** O que a pessoa responde ao aviso "buscar squad?" na DM. */
export type SquadDmChoice = 'search' | 'later' | 'optout';
const DM_CHOICES: readonly string[] = ['search', 'later', 'optout'];

/** Os botões da mensagem da jogatina: VOU (ou ESPERA, ou PEDIR VAGA) e SAIR. */
export type AgendaAction = 'join' | 'leave';
const AGENDA_ACTIONS: readonly string[] = ['join', 'leave'];

export type RequestAnswer = 'ok' | 'no';

export type SquadCustomId =
  | { kind: 'search' }
  | { kind: 'optout' }
  | { kind: 'schedule' }
  | { kind: 'visibility'; visibility: LfgVisibility }
  | { kind: 'agenda'; action: AgendaAction; sessionId: string }
  | { kind: 'request'; answer: RequestAnswer; guildId: string; sessionId: string; userId: string }
  | { kind: 'dm'; choice: SquadDmChoice; guildId: string };

export const SEARCH_TOGGLE_ID = `${SQUAD_PREFIX}:search`;
export const OPT_OUT_TOGGLE_ID = `${SQUAD_PREFIX}:optout`;
export const SCHEDULE_ID = `${SQUAD_PREFIX}:schedule`;
/** Os campos do modal da jogatina. */
export const SCHEDULE_FIELDS = { when: 'when', slots: 'slots', note: 'note' } as const;

function assertSnowflake(value: string, what: string): void {
  if (!SNOWFLAKE_RE.test(value)) throw new RangeError(`${what} inválido: ${value}`);
}

export function squadDmId(choice: SquadDmChoice, guildId: string): string {
  assertSnowflake(guildId, 'guildId');
  return `${SQUAD_PREFIX}:dm:${choice}:${guildId}`;
}

export function visibilityId(visibility: LfgVisibility): string {
  return `${SQUAD_PREFIX}:vis:${visibility}`;
}

export function agendaId(action: AgendaAction, sessionId: string): string {
  if (!UUID_RE.test(sessionId)) throw new RangeError(`sessionId inválido: ${sessionId}`);
  return `${SQUAD_PREFIX}:a:${action}:${sessionId}`;
}

export function requestId(
  answer: RequestAnswer,
  guildId: string,
  sessionId: string,
  userId: string,
): string {
  assertSnowflake(guildId, 'guildId');
  assertSnowflake(userId, 'userId');
  if (!UUID_RE.test(sessionId)) throw new RangeError(`sessionId inválido: ${sessionId}`);
  return `${SQUAD_PREFIX}:req:${answer}:${guildId}:${sessionId}:${userId}`;
}

/**
 * `null` para tudo o que não é deste módulo **nesta versão**: inclusive os
 * botões do squad fixo que ainda estão no ar em mensagens antigas, que o
 * handler responde dizendo que aquele fluxo acabou.
 */
export function parseSquadId(customId: string): SquadCustomId | null {
  const [prefix, kind, ...rest] = customId.split(':');
  if (prefix !== SQUAD_PREFIX) return null;
  if (kind === 'search' && rest.length === 0) return { kind: 'search' };
  if (kind === 'optout' && rest.length === 0) return { kind: 'optout' };
  if (kind === 'schedule' && rest.length === 0) return { kind: 'schedule' };
  if (kind === 'vis' && rest.length === 1) {
    const [visibility] = rest as [string];
    if (!(LFG_VISIBILITIES as readonly string[]).includes(visibility)) return null;
    return { kind: 'visibility', visibility: visibility as LfgVisibility };
  }
  if (kind === 'a' && rest.length === 2) {
    const [action, sessionId] = rest as [string, string];
    if (!AGENDA_ACTIONS.includes(action) || !UUID_RE.test(sessionId)) return null;
    return { kind: 'agenda', action: action as AgendaAction, sessionId };
  }
  if (kind === 'req' && rest.length === 4) {
    const [answer, guildId, sessionId, userId] = rest as [string, string, string, string];
    if (answer !== 'ok' && answer !== 'no') return null;
    if (!SNOWFLAKE_RE.test(guildId) || !SNOWFLAKE_RE.test(userId)) return null;
    if (!UUID_RE.test(sessionId)) return null;
    return { kind: 'request', answer, guildId, sessionId, userId };
  }
  if (kind === 'dm' && rest.length === 2) {
    const [choice, guildId] = rest as [string, string];
    if (!DM_CHOICES.includes(choice) || !SNOWFLAKE_RE.test(guildId)) return null;
    return { kind: 'dm', choice: choice as SquadDmChoice, guildId };
  }
  return null;
}

/** Os botões que chegam por DM: o aviso automático e a resposta a um pedido. */
export function isSquadDmId(customId: string): boolean {
  const kind = parseSquadId(customId)?.kind;
  return kind === 'dm' || kind === 'request';
}
