import { renderMessageTemplate } from '@cobot/shared';
import { EmbedBuilder } from 'discord.js';

import { DEFAULT_EMBED_COLOR } from './embeds';

import type { EmbedTemplate, MessageTemplate, TemplateVars } from '@cobot/shared';
import type {
  BaseMessageOptions,
  Guild,
  GuildMember,
  MessageMentionOptions,
  PartialGuildMember,
  User,
} from 'discord.js';

/**
 * Só `{mention}` deve virar ping. Um apelido como `@everyone` não pode
 * escapar para dentro do texto renderizado, então toda variável passa por
 * aqui antes de entrar no template.
 */
export function sanitizeVar(value: string): string {
  return value.replace(/@(everyone|here)/g, '@\u200b$1');
}

/** Ordinal em pt-BR: `1234` → `1234º`. */
export function ordinal(position: number): string {
  return `${position}º`;
}

/** Valores de `TEMPLATE_VARIABLES` para um membro (PRD §5.5). */
export function memberVars(
  member: GuildMember | PartialGuildMember,
  memberCount?: number,
): TemplateVars {
  const count = memberCount ?? member.guild.memberCount;
  return {
    user: sanitizeVar(member.user.displayName || member.user.username),
    mention: `<@${member.id}>`,
    tag: sanitizeVar(member.user.tag),
    id: member.id,
    server: sanitizeVar(member.guild.name),
    memberCount: count,
    ordinal: ordinal(count),
  };
}

export interface TemplateMessageOptions {
  /** Cor usada quando `embed.color` é `null` (`guild_settings.embed_color`). */
  embedColor?: number;
  /** Resolve `thumbnail: 'user_avatar'`. */
  user?: User;
  /** Resolve `thumbnail: 'server_icon'`. */
  guild?: Guild;
  /**
   * Quem a mensagem pode mencionar. O padrão (só usuários) é o que as
   * mensagens do próprio bot precisam — `{mention}` tem que pingar quem
   * entrou. O painel manda o dele, montado a partir das caixas do editor.
   */
  allowedMentions?: MessageMentionOptions;
}

function buildEmbed(template: EmbedTemplate, options: TemplateMessageOptions): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(
    template.color ?? options.embedColor ?? DEFAULT_EMBED_COLOR,
  );
  if (template.title) embed.setTitle(template.title);
  if (template.description) embed.setDescription(template.description);
  if (template.url) embed.setURL(template.url);
  if (template.fields.length > 0) embed.addFields(template.fields);
  if (template.footer) embed.setFooter({ text: template.footer });
  if (template.image) embed.setImage(template.image);
  if (template.timestamp) embed.setTimestamp(new Date());

  const thumbnail =
    template.thumbnail === 'user_avatar'
      ? (options.user?.displayAvatarURL() ?? null)
      : template.thumbnail === 'server_icon'
        ? (options.guild?.iconURL() ?? null)
        : (template.thumbnail ?? null);
  if (thumbnail) embed.setThumbnail(thumbnail);

  return embed;
}

/**
 * Renderiza um `MessageTemplate` e o converte no payload do discord.js.
 * `allowedMentions` deixa passar só menções de usuário por padrão: nem
 * `@everyone` nem cargos, mesmo que alguém escreva isso no template pelo
 * painel. Quem quiser outra coisa manda o campo explicitamente.
 */
export function templateToMessage(
  template: MessageTemplate,
  vars: TemplateVars,
  options: TemplateMessageOptions = {},
): BaseMessageOptions {
  const rendered = renderMessageTemplate(template, vars);
  const message: BaseMessageOptions = {
    allowedMentions: options.allowedMentions ?? { parse: ['users'] },
  };
  if (rendered.content?.trim()) message.content = rendered.content;
  if (rendered.embed) message.embeds = [buildEmbed(rendered.embed, options)];
  return message;
}
