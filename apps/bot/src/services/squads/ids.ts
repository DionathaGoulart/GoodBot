/**
 * `custom_id` dos componentes do módulo `squads`. O prefixo `squad` roteia
 * (ver `interactions/index.ts`) e o resto é lido aqui, num lugar só, para o
 * builder e o parser nunca divergirem.
 *
 * - `squad:schedule`: o botão MARCAR JOGATINA e o modal que ele abre.
 * - `squad:vis:<open|closed>`: ABERTA ou FECHADA, logo depois do modal.
 * - `squad:a:<ação>:<sessionId>`: os botões da mensagem da jogatina na agenda.
 * - `squad:m:<op>:<sessionId>`: o GERENCIAR, efêmero de quem marcou ou da
 *   staff. REMARCAR e VAGAS usam o mesmo id no botão e no modal que ele abre.
 * - `squad:req:<ok|no>:<guildId>:<sessionId>:<userId>`: ACEITAR e RECUSAR um
 *   pedido de vaga. Vai na DM do host e, com a DM fechada, na thread; a DM não
 *   pertence a servidor nenhum, então a guild viaja no próprio `custom_id`.
 *
 * Os ids que saíram (`squad:search`, `squad:optout`, `squad:dm:*` do aviso por
 * presença, os do squad fixo) não são lidos: o handler responde que aquele
 * fluxo acabou.
 */

import { LFG_VISIBILITIES } from '@goodbot/shared';

import type { LfgVisibility } from '@goodbot/shared';

export const SQUAD_PREFIX = 'squad';

const SNOWFLAKE_RE = /^\d{17,20}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Os botões da mensagem da jogatina: VOU (ou ESPERA, ou PEDIR VAGA), SAIR e GERENCIAR. */
export type AgendaAction = 'join' | 'leave' | 'manage';
const AGENDA_ACTIONS: readonly string[] = ['join', 'leave', 'manage'];

/**
 * O que o GERENCIAR faz: `home` volta ao painel, `when` e `slots` são os
 * modais, `vis` abre ou fecha, `kick` é o select de TIRAR ALGUÉM, `cancel`
 * pede confirmação e `cancelok` confirma.
 */
export type ManageOp = 'home' | 'when' | 'slots' | 'vis' | 'kick' | 'cancel' | 'cancelok';
const MANAGE_OPS: readonly string[] = [
  'home',
  'when',
  'slots',
  'vis',
  'kick',
  'cancel',
  'cancelok',
];

export type RequestAnswer = 'ok' | 'no';

export type SquadCustomId =
  | { kind: 'schedule' }
  | { kind: 'visibility'; visibility: LfgVisibility }
  | { kind: 'agenda'; action: AgendaAction; sessionId: string }
  | { kind: 'manage'; op: ManageOp; sessionId: string }
  | { kind: 'request'; answer: RequestAnswer; guildId: string; sessionId: string; userId: string };

export const SCHEDULE_ID = `${SQUAD_PREFIX}:schedule`;
/** Os campos do modal da jogatina. */
export const SCHEDULE_FIELDS = { when: 'when', slots: 'slots', note: 'note' } as const;

function assertSnowflake(value: string, what: string): void {
  if (!SNOWFLAKE_RE.test(value)) throw new RangeError(`${what} inválido: ${value}`);
}

export function visibilityId(visibility: LfgVisibility): string {
  return `${SQUAD_PREFIX}:vis:${visibility}`;
}

export function agendaId(action: AgendaAction, sessionId: string): string {
  if (!UUID_RE.test(sessionId)) throw new RangeError(`sessionId inválido: ${sessionId}`);
  return `${SQUAD_PREFIX}:a:${action}:${sessionId}`;
}

export function manageId(op: ManageOp, sessionId: string): string {
  if (!UUID_RE.test(sessionId)) throw new RangeError(`sessionId inválido: ${sessionId}`);
  return `${SQUAD_PREFIX}:m:${op}:${sessionId}`;
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
  if (kind === 'm' && rest.length === 2) {
    const [op, sessionId] = rest as [string, string];
    if (!MANAGE_OPS.includes(op) || !UUID_RE.test(sessionId)) return null;
    return { kind: 'manage', op: op as ManageOp, sessionId };
  }
  if (kind === 'req' && rest.length === 4) {
    const [answer, guildId, sessionId, userId] = rest as [string, string, string, string];
    if (answer !== 'ok' && answer !== 'no') return null;
    if (!SNOWFLAKE_RE.test(guildId) || !SNOWFLAKE_RE.test(userId)) return null;
    if (!UUID_RE.test(sessionId)) return null;
    return { kind: 'request', answer, guildId, sessionId, userId };
  }
  return null;
}

/**
 * Botão do módulo que chegou por DM. Hoje só a resposta a um pedido de vaga é
 * tratada; os do aviso por presença, que ainda estão em DMs antigas, também
 * passam aqui, para ouvir que o fluxo acabou em vez de falhar mudo.
 */
export function isSquadDmId(customId: string): boolean {
  return customId.split(':')[0] === SQUAD_PREFIX;
}
