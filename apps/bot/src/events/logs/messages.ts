import { AttachmentBuilder, Events } from 'discord.js';

import { defineEvent } from '../../lib/event';
import {
  channelMention,
  channelValue,
  logEmbed,
  logFooter,
  sentence,
  userIdValue,
  userMention,
  userValue,
} from '../../lib/log-embeds';
import { fieldValue, formatDiff, quoteBlock } from '../../services/logs';

import type { BotContext } from '../../lib/command';
import type { CachedContent } from '../../services/message-cache';
import type { CachedAttachment } from '@goodbot/db';
import type { LogsConfig } from '@goodbot/shared';
import type { APIEmbedField, Message, PartialMessage } from 'discord.js';

/** Link direto para a mensagem no cliente do Discord. */
function messageLink(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

/** `foto.png (1.2 MB)` — o bot guarda nome e tamanho, nunca o arquivo. */
function attachmentList(attachments: readonly CachedAttachment[]): string {
  if (attachments.length === 0) return '—';
  return attachments.map((file) => `${file.name} (${(file.size / 1024).toFixed(1)} KB)`).join('\n');
}

/** Config do módulo `logs`, já com defaults. */
async function logsConfig(ctx: BotContext, guildId: string): Promise<LogsConfig> {
  return ctx.config.get(guildId, 'logs');
}

/** Bot que fala pouco e o próprio Goodbot nunca entram no log de mensagens. */
function skipAuthor(message: Message | PartialMessage, config: LogsConfig): boolean {
  if (!message.author) return false;
  return config.ignoreBots && message.author.bot;
}

/**
 * `messageCreate` só alimenta o `message_cache`: sem ele, apagar uma mensagem
 * anterior ao boot do bot geraria um log vazio (PRD §5.4).
 */
export const messageCreate = defineEvent(Events.MessageCreate, async (ctx, message) => {
  if (!message.guildId || message.author.bot) return;
  const config = await logsConfig(ctx, message.guildId);
  if (!config.enabled || !config.messageCache.enabled) return;
  ctx.messageCache.record(message);
});

export const messageUpdate = defineEvent(
  Events.MessageUpdate,
  async (ctx, oldMessage, newMessage) => {
    const guildId = newMessage.guildId;
    if (!guildId) return;

    const config = await logsConfig(ctx, guildId);
    if (!config.enabled) return;

    const message = newMessage.partial ? await newMessage.fetch().catch(() => null) : newMessage;
    if (!message || !message.author || skipAuthor(message, config)) return;

    // Embeds carregando depois do envio disparam `messageUpdate` sem edição.
    const before =
      (oldMessage.partial ? null : oldMessage.content) ??
      (await ctx.messageCache.get(message.channelId, message.id))?.content ??
      null;
    if (before !== null && before === message.content) return;

    if (config.messageCache.enabled) ctx.messageCache.record(message);

    const embed = logEmbed({
      title: 'Mensagem editada',
      tone: 'update',
      description: [
        sentence(
          `${userMention(message.author)} editou uma mensagem em ${channelMention(message.channelId)}`,
        ),
        `[ir para a mensagem](${messageLink(guildId, message.channelId, message.id)})`,
      ].join('\n'),
      fields: [
        { name: 'Autor', value: userValue(message.author), inline: true },
        { name: 'Canal', value: channelValue(message.channelId), inline: true },
        ...formatDiff(before, message.content),
      ],
      footer: logFooter(`MENSAGEM: ${message.id}`),
    });

    await ctx.logs.emit(
      guildId,
      'messages',
      { embeds: [embed] },
      { channelId: message.channelId, roleIds: memberRoles(message) },
    );
  },
);

export const messageDelete = defineEvent(Events.MessageDelete, async (ctx, message) => {
  const guildId = message.guildId;
  if (!guildId) return;

  const config = await logsConfig(ctx, guildId);
  if (!config.enabled) return;
  if (skipAuthor(message, config)) return;

  const cached = await ctx.messageCache.get(message.channelId, message.id);
  // Mensagem fora do cache do discord.js e do nosso: sobra o que o evento traz.
  const content = message.partial ? (cached?.content ?? null) : message.content;
  const attachments: CachedAttachment[] = message.partial
    ? (cached?.attachments ?? [])
    : [...message.attachments.values()].map((file) => ({
        name: file.name,
        size: file.size,
        contentType: file.contentType,
      }));
  const authorId = message.author?.id ?? cached?.authorId ?? null;

  const fields: APIEmbedField[] = [
    {
      name: 'Autor',
      value: authorId ? userIdValue(authorId) : 'desconhecido',
      inline: true,
    },
    { name: 'Canal', value: channelValue(message.channelId), inline: true },
    { name: 'Conteúdo', value: quoteBlock(content), inline: false },
  ];
  if (attachments.length > 0) {
    fields.push({ name: 'Anexos', value: fieldValue(attachmentList(attachments)), inline: false });
  }

  const embed = logEmbed({
    title: 'Mensagem apagada',
    tone: 'delete',
    // Quem apagou não vem no evento: pode ter sido o próprio autor ou um mod,
    // e o audit log só registra o segundo caso. A frase fica na voz passiva em
    // vez de acusar a pessoa errada.
    description: sentence(
      'Uma mensagem de',
      authorId ? userMention({ id: authorId }) : 'um usuário desconhecido',
      `foi apagada em ${channelMention(message.channelId)}`,
    ),
    fields,
    footer: logFooter(`MENSAGEM: ${message.id}`),
  });

  await ctx.logs.emit(
    guildId,
    'messages',
    { embeds: [embed] },
    { channelId: message.channelId, roleIds: memberRoles(message) },
  );
});

export const messageDeleteBulk = defineEvent(
  Events.MessageBulkDelete,
  async (ctx, messages, channel) => {
    const guildId = channel.guildId;
    if (!guildId) return;

    const config = await logsConfig(ctx, guildId);
    if (!config.enabled) return;

    const ids = [...messages.keys()];
    const cached = await ctx.messageCache.getMany(channel.id, ids);
    const byId = new Map(cached.map((entry) => [entry.messageId, entry] as const));

    const embed = logEmbed({
      title: 'Mensagens apagadas em massa',
      tone: 'delete',
      description: sentence(
        `${messages.size} mensagens foram apagadas de uma vez em ${channelMention(channel.id)}`,
        config.bulkDeleteAttachFile ? 'o conteúdo vai no arquivo anexo' : null,
      ),
      fields: [
        { name: 'Quantidade', value: String(messages.size), inline: true },
        { name: 'Canal', value: channelValue(channel.id, channel.name), inline: true },
      ],
      footer: logFooter(`CANAL: ${channel.id}`),
    });

    // O conteúdo não cabe em embed: vai como `.txt` anexo (PRD §5.4).
    const files = config.bulkDeleteAttachFile
      ? [
          new AttachmentBuilder(Buffer.from(transcript(messages, byId), 'utf8'), {
            name: `bulk-delete-${channel.id}-${Date.now()}.txt`,
          }),
        ]
      : undefined;

    await ctx.logs.emit(guildId, 'messages', { embeds: [embed], files }, { channelId: channel.id });
  },
);

/** Uma linha por mensagem, da mais antiga para a mais recente. */
function transcript(
  messages: ReadonlyMap<string, Message | PartialMessage>,
  cached: ReadonlyMap<string, CachedContent>,
): string {
  const lines = [...messages.values()]
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map((message) => {
      const fallback = cached.get(message.id);
      const author = message.author?.tag ?? fallback?.authorId ?? 'desconhecido';
      const content = (message.partial ? fallback?.content : message.content) || '[sem conteúdo]';
      const when = message.createdAt?.toISOString() ?? '';
      return `[${when}] ${author} (${message.id}): ${content}`;
    });
  return lines.length > 0 ? lines.join('\n') : 'Nenhuma mensagem recuperável.';
}

/** Cargos do autor, quando o membro está no cache — base dos ignorados. */
function memberRoles(message: Message | PartialMessage): string[] | undefined {
  const member = message.member;
  return member && 'roles' in member ? [...member.roles.cache.keys()] : undefined;
}
