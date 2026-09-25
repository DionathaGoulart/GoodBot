/**
 * `custom_id` dos componentes do módulo `squads`. O prefixo `squad` roteia
 * (ver `interactions/index.ts`) e o resto é lido aqui, num lugar só, para o
 * builder e o parser nunca divergirem.
 *
 * - `squad:call`: o botão PROCURAR AGORA e o modal do card que ele abre.
 * - `squad:schedule`: o botão MARCAR JOGATINA e o modal que ele abre.
 * - `squad:mine`: MINHAS JOGATINAS. `squad:notify`: ME AVISA, o toggle do `Bora`.
 * - `squad:a:<ação>:<sessionId>`: os botões da mensagem da jogatina na agenda.
 * - `squad:m:<op>:<sessionId>`: o GERENCIAR, efêmero de quem marcou ou da
 *   staff. REMARCAR e VAGAS usam o mesmo id no botão e no modal que ele abre.
 * - `squad:req:<ok|no>:<guildId>:<sessionId>:<userId>`: ACEITAR e RECUSAR um
 *   pedido de vaga. Vai na DM do host e, com a DM fechada, na thread; a DM não
 *   pertence a servidor nenhum, então a guild viaja no próprio `custom_id`.
 *
 * Os ids que saíram (`squad:search`, `squad:optout`, `squad:dm:*` do aviso por
 * presença, `squad:vis:*` da escolha ABERTA ou FECHADA, os do squad fixo) não
 * são lidos: o handler responde que aquele
 * fluxo acabou.
 */

export const SQUAD_PREFIX = 'squad';

const SNOWFLAKE_RE = /^\d{17,20}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Os botões da mensagem da jogatina: VOU (ou PEDIR VAGA), SAIR e GERENCIAR. */
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
  | { kind: 'call' }
  | { kind: 'schedule' }
  | { kind: 'mine' }
  | { kind: 'notify' }
  | { kind: 'agenda'; action: AgendaAction; sessionId: string }
  | { kind: 'manage'; op: ManageOp; sessionId: string }
  | { kind: 'request'; answer: RequestAnswer; guildId: string; sessionId: string; userId: string };

export const CALL_ID = `${SQUAD_PREFIX}:call`;
export const SCHEDULE_ID = `${SQUAD_PREFIX}:schedule`;
export const MINE_ID = `${SQUAD_PREFIX}:mine`;
export const NOTIFY_TOGGLE_ID = `${SQUAD_PREFIX}:notify`;
/** Os campos do modal do card. */
export const CALL_FIELDS = { what: 'what', slots: 'slots' } as const;
/** Os campos do modal da jogatina. */
export const SCHEDULE_FIELDS = { when: 'when', slots: 'slots', note: 'note' } as const;

/** Os botões do `#jogatinas` que não levam nada além do próprio nome. */
const SIMPLE_KINDS: readonly string[] = ['call', 'schedule', 'mine', 'notify'];

function assertSnowflake(value: string, what: string): void {
  if (!SNOWFLAKE_RE.test(value)) throw new RangeError(`${what} inválido: ${value}`);
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
  if (kind !== undefined && SIMPLE_KINDS.includes(kind) && rest.length === 0) {
    return { kind: kind as 'call' | 'schedule' | 'mine' | 'notify' };
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
