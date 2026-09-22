import { MAX_NAME_LENGTH } from '@goodbot/shared';

import { slugifyChannelName } from '../tickets';

import type { SquadBlockConfig } from '@goodbot/shared';

/** Dias da grade, na ordem dos bits: 0 = domingo. */
export const SQUAD_DAY_NAMES = [
  'domingo',
  'segunda',
  'terça',
  'quarta',
  'quinta',
  'sexta',
  'sábado',
] as const;

/** Nome de reserva quando o padrão não sobra nada depois do saneamento. */
export const SQUAD_CHANNEL_FALLBACK = 'squad';

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

function dayName(day: number): string {
  const name = SQUAD_DAY_NAMES[day];
  if (name === undefined) throw new RangeError(`Dia fora da grade: ${String(day)}.`);
  return name;
}

/**
 * Janela semanal em pt-BR, como o jogador lê: "Sábado, Noite (18h às 24h)".
 *
 * A madrugada é o começo do próprio dia (0h às 6h), então "madrugada de
 * sábado" é a noite de sexta para sábado. Quem lê "sábado" sem esse aviso
 * aparece um dia atrasado, por isso a faixa `night` sempre diz as duas datas.
 */
export function formatSlot(
  day: number,
  block: number,
  blocks: readonly SquadBlockConfig[],
): string {
  const name = dayName(day);
  const config = blocks[block];
  if (!config) throw new RangeError(`Faixa fora da grade: ${String(block)}.`);
  const hours = `${String(config.startHour)}h às ${String(config.endHour)}h`;

  if (config.key === 'night') {
    const previous = dayName((day + SQUAD_DAY_NAMES.length - 1) % SQUAD_DAY_NAMES.length);
    return `${capitalize(config.label)} de ${name} (${hours}, noite de ${previous} para ${name})`;
  }
  return `${capitalize(name)}, ${config.label} (${hours})`;
}

/** Nome do canal de texto do squad: `channelNaming` com `{name}`, saneado. */
export function renderSquadChannelName(pattern: string, name: string): string {
  return slugifyChannelName(pattern.replaceAll('{name}', name)) || SQUAD_CHANNEL_FALLBACK;
}

/** Nome da thread privada de uma proposta: `squad-<jogo>`. */
export function renderProposalThreadName(gameName: string): string {
  return slugifyChannelName(`squad-${gameName}`) || SQUAD_CHANNEL_FALLBACK;
}

/** Nome da thread privada de um convite para squad: `convite-<squad>`. */
export function renderInviteThreadName(squadName: string): string {
  return slugifyChannelName(`convite-${squadName}`) || SQUAD_CHANNEL_FALLBACK;
}

/** Nome da thread privada de um convidado avulso: `jogatina-<squad>`. */
export function renderGuestThreadName(squadName: string): string {
  return slugifyChannelName(`jogatina-${squadName}`) || SQUAD_CHANNEL_FALLBACK;
}

/** Nome inicial de um squad: `<jogo> #<n>`, cortando o jogo para caber no teto de nome. */
export function defaultSquadName(gameName: string, number: number): string {
  const suffix = ` #${String(number)}`;
  return `${gameName.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`;
}
