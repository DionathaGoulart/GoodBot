import { MAX_MESSAGE_CONTENT_LENGTH } from '@cobot/shared';
import { EmbedBuilder } from 'discord.js';

import { sanitizeVar, templateToMessage } from '../../lib/template';

import type { SocialItem } from './types';
import type { MessageTemplate, SocialKind, SocialPlatform, TemplateVars } from '@cobot/shared';
import type { BaseMessageOptions } from 'discord.js';

export const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  youtube: 'YouTube',
  twitch: 'Twitch',
  instagram: 'Instagram',
  tiktok: 'TikTok',
};

export const KIND_LABEL: Record<SocialKind, string> = {
  video: 'vídeo',
  short: 'short',
  live: 'live',
  post: 'publicação',
};

/** As variáveis de template de uma publicação (PRD §5.8). */
export function socialVars(item: SocialItem, platform: SocialPlatform): TemplateVars {
  return {
    title: sanitizeVar(item.title),
    url: item.url,
    author: sanitizeVar(item.author),
    thumbnail: item.thumbnail ?? '',
    platform: PLATFORM_LABEL[platform],
    kind: KIND_LABEL[item.kind],
  };
}

export interface SocialMessageOptions {
  embedColor?: number;
  /** Único cargo que a mensagem pode pingar. */
  mentionRoleId?: string | null;
}

/**
 * Monta o anúncio a partir do template da conta. Duas decisões que o template
 * não expressa sozinho:
 *
 * · a capa da publicação vira a **imagem** do embed quando o autor não pôs uma
 *   própria — é o que dá ao anúncio a cara de card do YouTube;
 * · `allowedMentions` fica restrito ao cargo configurado. Nem `@everyone`, nem
 *   outros cargos, nem usuários, mesmo que alguém escreva isso no template
 *   pelo painel (PRD §5.8 e §7.3).
 */
export function buildSocialMessage(
  template: MessageTemplate,
  item: SocialItem,
  platform: SocialPlatform,
  options: SocialMessageOptions = {},
): BaseMessageOptions {
  const message = templateToMessage(template, socialVars(item, platform), {
    ...(options.embedColor === undefined ? {} : { embedColor: options.embedColor }),
  });

  const roleId = options.mentionRoleId ?? null;
  const content = roleId
    ? `<@&${roleId}> ${message.content ?? ''}`.trim().slice(0, MAX_MESSAGE_CONTENT_LENGTH)
    : message.content;

  // `templateToMessage` sempre devolve um `EmbedBuilder`; a capa da publicação
  // só entra quando o autor do template não escolheu uma imagem própria.
  const embed = message.embeds?.[0];
  if (embed instanceof EmbedBuilder && item.thumbnail && !embed.data.image) {
    embed.setImage(item.thumbnail);
  }

  return {
    ...message,
    ...(content ? { content } : {}),
    allowedMentions: { parse: [], roles: roleId ? [roleId] : [] },
  };
}

/** Uma publicação de mentira para o botão "testar" e o `/social test`. */
export function sampleSocialItem(platform: SocialPlatform, kind: SocialKind): SocialItem {
  return {
    externalId: 'teste',
    kind,
    title: `Exemplo de ${KIND_LABEL[kind]} no ${PLATFORM_LABEL[platform]}`,
    url: 'https://example.com/exemplo',
    author: 'Canal de exemplo',
    thumbnail: null,
    publishedAt: new Date(),
  };
}
