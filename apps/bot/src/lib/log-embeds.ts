import { EmbedBuilder } from 'discord.js';

import { formatTitle, STATUS_COLORS } from './embeds';

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
  /**
   * A frase que resume o evento em linguagem de gente: quem fez, o quê, onde.
   * É a primeira coisa lida no card, e na maioria dos logs já basta — os
   * fields abaixo ficam para o detalhe de quem quiser conferir.
   */
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

// ── menções ─────────────────────────────────────────────────────────────────
//
// O cliente do Discord resolve `<@id>`, `<#id>` e `<@&id>` no nome, com link.
// Repetir o snowflake ao lado só ocupa a largura do card com um número que
// ninguém lê — quando o ID importa (suporte, busca no audit log) ele está no
// rodapé, que é onde se procura por ele.

export function userMention(user: UserLike): string {
  return `<@${user.id}>`;
}

export function channelMention(channelId: string): string {
  return `<#${channelId}>`;
}

export function roleMention(roleId: string): string {
  return `<@&${roleId}>`;
}

/** Menção + tag, para o field de usuário. */
export function userValue(user: UserLike): string {
  return user.tag ? `${userMention(user)} (${user.tag})` : userMention(user);
}

/** Mesma forma, quando só se conhece o ID (autor fora do cache). */
export function userIdValue(userId: string): string {
  return userMention({ id: userId });
}

/**
 * Field de canal. O nome vai junto só quando o canal **não existe mais** — aí
 * a menção viraria "#deleted-channel" e o nome é a única pista que sobra.
 */
export function channelValue(channelId: string, name?: string | null): string {
  return name ? `${channelMention(channelId)} (#${name})` : channelMention(channelId);
}

export function roleValue(roleId: string, name?: string | null): string {
  return name ? `${roleMention(roleId)} (${name})` : roleMention(roleId);
}

/** Lista de menções de cargo, ou um traço quando vazia. */
export function roleMentions(roleIds: readonly string[], max = 20): string {
  if (roleIds.length === 0) return '—';
  const shown = roleIds.slice(0, max).map((id) => roleMention(id));
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

// ── frase de resumo ─────────────────────────────────────────────────────────

/**
 * Quem fez a ação. O audit log só responde quando a mudança passou por ele e
 * dentro do timeout de `findAuditEntry`; sem resposta o log não pode inventar
 * um autor, e "alguém" é mais honesto que omitir o sujeito da frase.
 */
export function actor(executor: UserLike | null): string {
  return executor ? userMention(executor) : 'alguém';
}

/**
 * Junta os pedaços de uma frase e fecha com ponto. Pedaços vazios somem, o que
 * deixa o call site escrever a parte opcional inline (`canal && \`em ${canal}\``)
 * sem montar array condicional.
 */
export function sentence(...parts: (string | null | undefined | false)[]): string {
  const text = parts.filter((part): part is string => Boolean(part)).join(' ');
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * `sentence` + o motivo do audit log entre parênteses, que é o "por quê" de
 * toda ação de moderação feita fora do bot.
 */
export function reasonSuffix(reason?: string | null): string | null {
  return reason ? `Motivo: ${reason}` : null;
}
