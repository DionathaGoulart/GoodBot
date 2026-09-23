/**
 * `custom_id` dos componentes do módulo `squads`. O prefixo `squad` roteia
 * (ver `interactions/index.ts`) e o resto é lido aqui, num lugar só, para o
 * builder e o parser nunca divergirem.
 *
 * - `squad:search` e `squad:optout`: os toggles, em mensagem de servidor.
 * - `squad:dm:<escolha>:<guildId>`: os botões do aviso automático. A DM não
 *   pertence a servidor nenhum, então a guild viaja no próprio `custom_id`.
 */

export const SQUAD_PREFIX = 'squad';

const SNOWFLAKE_RE = /^\d{17,20}$/;

/** O que a pessoa responde ao aviso "buscar squad?" na DM. */
export type SquadDmChoice = 'search' | 'later' | 'optout';
const DM_CHOICES: readonly string[] = ['search', 'later', 'optout'];

export type SquadCustomId =
  { kind: 'search' } | { kind: 'optout' } | { kind: 'dm'; choice: SquadDmChoice; guildId: string };

export const SEARCH_TOGGLE_ID = `${SQUAD_PREFIX}:search`;
export const OPT_OUT_TOGGLE_ID = `${SQUAD_PREFIX}:optout`;

export function squadDmId(choice: SquadDmChoice, guildId: string): string {
  if (!SNOWFLAKE_RE.test(guildId)) throw new RangeError(`guildId inválido: ${guildId}`);
  return `${SQUAD_PREFIX}:dm:${choice}:${guildId}`;
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
  if (kind === 'dm' && rest.length === 2) {
    const [choice, guildId] = rest as [string, string];
    if (!DM_CHOICES.includes(choice) || !SNOWFLAKE_RE.test(guildId)) return null;
    return { kind: 'dm', choice: choice as SquadDmChoice, guildId };
  }
  return null;
}
