import { EmbedBuilder } from 'discord.js';

import { code, formatTitle, STATUS_COLORS } from './embeds';

import type { APIEmbedField } from 'discord.js';

/** O mínimo de um usuário para virar field: um `tag` ausente vira só a menção. */
export interface UserLike {
  id: string;
  tag?: string | null;
}

/**
 * Cor por natureza do evento (styleguide §9): criar é verde, apagar é
 * vermelho, editar é âmbar e o resto é azul informativo.
 */
export const LOG_COLORS = {
  create: STATUS_COLORS.success,
  update: STATUS_COLORS.warning,
  delete: STATUS_COLORS.danger,
  info: STATUS_COLORS.info,
} as const;

export type LogTone = keyof typeof LOG_COLORS;

export interface LogEmbedInput {
  title: string;
  tone: LogTone;
  description?: string;
  fields?: APIEmbedField[];
  /** Vira o rodapé; IDs entram aqui (`ID DA MENSAGEM: …`). */
  footer?: string;
  timestamp?: Date;
}

/** Embed padrão de log: título em caixa alta com `>` e cor pela natureza. */
export function logEmbed(input: LogEmbedInput): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(LOG_COLORS[input.tone])
    .setTitle(formatTitle(input.title))
    .setTimestamp(input.timestamp ?? new Date());
  if (input.description) embed.setDescription(input.description);
  if (input.fields?.length) embed.addFields(input.fields);
  if (input.footer) embed.setFooter({ text: input.footer });
  return embed;
}

/** Menção + tag + ID em `inline code` — IDs nunca aparecem soltos. */
export function userValue(user: UserLike): string {
  const label = user.tag ? `<@${user.id}> ${user.tag}` : `<@${user.id}>`;
  return `${label}\n${code(user.id)}`;
}

/** Mesma forma, quando só se conhece o ID (autor fora do cache). */
export function userIdValue(userId: string): string {
  return `<@${userId}>\n${code(userId)}`;
}

export function channelValue(channelId: string, name?: string | null): string {
  const label = name ? `<#${channelId}> ${name}` : `<#${channelId}>`;
  return `${label}\n${code(channelId)}`;
}

export function roleValue(roleId: string, name?: string | null): string {
  const label = name ? `<@&${roleId}> ${name}` : `<@&${roleId}>`;
  return `${label}\n${code(roleId)}`;
}

/** Lista de menções de cargo, ou um traço quando vazia. */
export function roleMentions(roleIds: readonly string[], max = 20): string {
  if (roleIds.length === 0) return '—';
  const shown = roleIds.slice(0, max).map((id) => `<@&${id}>`);
  const rest = roleIds.length - shown.length;
  return rest > 0 ? `${shown.join(' ')} +${rest}` : shown.join(' ');
}

/** Rodapé de log: rótulo + ID em caixa alta, no formato dos casos. */
export function logFooter(...parts: (string | null | undefined)[]): string | undefined {
  const kept = parts.filter((part): part is string => Boolean(part));
  return kept.length > 0 ? kept.join(' · ') : undefined;
}

/** `por: @mod` quando o audit log revelou o autor da mudança. */
export function executorField(executor: UserLike | null, reason?: string | null): APIEmbedField[] {
  if (!executor) return [];
  const fields: APIEmbedField[] = [{ name: 'Por', value: userValue(executor), inline: true }];
  if (reason) fields.push({ name: 'Motivo', value: reason, inline: true });
  return fields;
}
