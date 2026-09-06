import { VERSION } from '@cobot/shared';
import { EmbedBuilder, type APIEmbedField } from 'discord.js';


/** Cores de status do styleguide §2.1/§9 (hex cheios). */
export const STATUS_COLORS = {
  danger: 0xdc2626,
  warning: 0xd97706,
  info: 0x2563eb,
  success: 0x16a34a,
} as const;

/** Cor padrão (`crimson`) quando a guild não configurou `embed_color`. */
export const DEFAULT_EMBED_COLOR = 0xdc143c;

export interface EmbedInput {
  title?: string;
  description?: string;
  fields?: APIEmbedField[];
  footer?: string;
  /** Sobrescreve a cor (moderação usa as de status). */
  color?: number;
}

/** Título em caixa alta com o prefixo `>` — styleguide §9. */
export function formatTitle(title: string): string {
  return `> ${title.toUpperCase()}`;
}

function build(input: EmbedInput, color: number): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(input.color ?? color);
  if (input.title) embed.setTitle(formatTitle(input.title));
  if (input.description) embed.setDescription(input.description);
  if (input.fields?.length) embed.addFields(input.fields);
  if (input.footer) embed.setFooter({ text: input.footer });
  return embed;
}

export function successEmbed(input: EmbedInput): EmbedBuilder {
  return build(input, STATUS_COLORS.success);
}

export function errorEmbed(input: EmbedInput): EmbedBuilder {
  return build(input, STATUS_COLORS.danger);
}

export function warningEmbed(input: EmbedInput): EmbedBuilder {
  return build(input, STATUS_COLORS.warning);
}

/** Embed neutro: usa a cor configurada da guild (`guild_settings.embed_color`). */
export function infoEmbed(input: EmbedInput, embedColor = DEFAULT_EMBED_COLOR): EmbedBuilder {
  return build(input, embedColor);
}

/** Rodapé padrão do bot. */
export function botFooter(suffix?: string): string {
  return suffix ? `COBOT v${VERSION} · ${suffix}` : `COBOT v${VERSION}`;
}

/** IDs sempre em `inline code` — styleguide §9. */
export function code(value: string): string {
  return `\`${value}\``;
}
