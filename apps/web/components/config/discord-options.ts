import type { GuildChannelSummary, GuildRoleSummary } from '@cobot/shared';

/** Um item do `DiscordPicker` (§6.4), já pronto para desenhar. */
export interface DiscordOption {
  id: string;
  label: string;
  /** Cor do cargo como inteiro RGB; `0` = sem cor (o Discord usa cinza). */
  color?: number;
  /** Categoria do canal, usada como cabeçalho de grupo na lista. */
  group?: string;
}

/** `ChannelType` do discord.js — os que interessam ao painel. */
export const CHANNEL_TYPES = {
  text: 0,
  voice: 2,
  category: 4,
  announcement: 5,
  stage: 13,
  forum: 15,
} as const;

/** Canais onde o bot consegue mandar mensagem de log/boas-vindas. */
export const TEXT_CHANNEL_TYPES = [CHANNEL_TYPES.text, CHANNEL_TYPES.announcement];

/** Sem acento e sem caixa: buscar "cargos" tem que achar "Cargos Secundários". */
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * Filtro da busca do picker. Casa por pedaço no nome (sem acento) ou pelo
 * começo do ID — colar um snowflake tem que achar o canal.
 */
export function filterOptions(options: DiscordOption[], query: string): DiscordOption[] {
  const term = normalizeSearch(query.trim());
  if (term === '') return options;
  return options.filter(
    (option) => normalizeSearch(option.label).includes(term) || option.id.startsWith(term),
  );
}

export function channelsToOptions(
  channels: GuildChannelSummary[],
  types: number[] = TEXT_CHANNEL_TYPES,
): DiscordOption[] {
  const categories = new Map(
    channels
      .filter((channel) => channel.type === CHANNEL_TYPES.category)
      .map((channel) => [channel.id, channel.name] as const),
  );

  return channels
    .filter((channel) => types.includes(channel.type))
    .sort((a, b) => a.position - b.position)
    .map((channel) => ({
      id: channel.id,
      label: channel.name,
      group: (channel.parentId && categories.get(channel.parentId)) || 'SEM CATEGORIA',
    }));
}

export function rolesToOptions(roles: GuildRoleSummary[]): DiscordOption[] {
  return roles
    .filter((role) => role.name !== '@everyone')
    .sort((a, b) => b.position - a.position)
    .map((role) => ({ id: role.id, label: role.name, color: role.color }));
}

/** Inteiro RGB → `#rrggbb`, o único lugar do painel onde um hex é dado. */
export function colorToHex(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

export function hexToColor(hex: string): number | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return match ? Number.parseInt(match[1]!, 16) : null;
}
