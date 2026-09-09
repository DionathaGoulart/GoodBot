import { AuditLogEvent, ChannelType, Events } from 'discord.js';

import { findAuditEntry } from '../../lib/audit-log';
import { defineEvent } from '../../lib/event';
import {
  actor,
  channelMention,
  channelValue,
  executorField,
  logEmbed,
  logFooter,
  reasonSuffix,
  roleMention,
  roleValue,
  sentence,
} from '../../lib/log-embeds';
import { fieldValue } from '../../services/logs';

import type { BotContext } from '../../lib/command';
import type { LogsConfig } from '@cobot/shared';
import type {
  APIEmbedField,
  DMChannel,
  Guild,
  GuildBasedChannel,
  NonThreadGuildBasedChannel,
  Role,
} from 'discord.js';

async function logsConfig(ctx: BotContext, guildId: string): Promise<LogsConfig> {
  return ctx.config.get(guildId, 'logs');
}

/** Nome legível do tipo de canal, para o log não mostrar o número do enum. */
const CHANNEL_TYPE_LABELS: Partial<Record<ChannelType, string>> = {
  [ChannelType.GuildText]: 'texto',
  [ChannelType.GuildVoice]: 'voz',
  [ChannelType.GuildCategory]: 'categoria',
  [ChannelType.GuildAnnouncement]: 'anúncios',
  [ChannelType.GuildStageVoice]: 'palco',
  [ChannelType.GuildForum]: 'fórum',
  [ChannelType.GuildMedia]: 'mídia',
};

function channelTypeLabel(type: ChannelType): string {
  return CHANNEL_TYPE_LABELS[type] ?? String(type);
}

/** Toda mudança de servidor entra no mesmo tipo de log (`server`). */
async function emitServer(
  ctx: BotContext,
  guild: Guild,
  embed: ReturnType<typeof logEmbed>,
): Promise<void> {
  await ctx.logs.emit(guild.id, 'server', { embeds: [embed] });
}

/**
 * Os nomes dos campos que mudaram, em minúscula, para caber na frase de
 * resumo: "editou #geral (nome, tópico)". Assim o card diz o que mudou antes
 * de a pessoa precisar ler os fields.
 */
function changeLabels(fields: readonly APIEmbedField[]): string {
  return fields.map((field) => field.name.toLowerCase()).join(', ');
}

// ── canais ──────────────────────────────────────────────────────────────────

export const channelCreate = defineEvent(Events.ChannelCreate, async (ctx, channel) => {
  const config = await logsConfig(ctx, channel.guild.id);
  if (!config.enabled) return;

  const audit = await findAuditEntry({
    guild: channel.guild,
    type: AuditLogEvent.ChannelCreate,
    targetId: channel.id,
  });

  await emitServer(
    ctx,
    channel.guild,
    logEmbed({
      title: 'Canal criado',
      tone: 'create',
      description: sentence(
        `${actor(audit.executor)} criou o canal de ${channelTypeLabel(channel.type)}`,
        channelMention(channel.id),
        reasonSuffix(audit.reason),
      ),
      fields: [
        { name: 'Canal', value: channelValue(channel.id, channel.name), inline: true },
        { name: 'Tipo', value: channelTypeLabel(channel.type), inline: true },
        ...executorField(audit.executor, audit.reason),
      ],
      footer: logFooter(`CANAL: ${channel.id}`),
    }),
  );
});

export const channelDelete = defineEvent(Events.ChannelDelete, async (ctx, channel) => {
  if (isDm(channel)) return;
  const config = await logsConfig(ctx, channel.guild.id);
  // O cache de mensagens do canal não serve mais para nada.
  ctx.messageCache.forgetChannel(channel.id);
  if (!config.enabled) return;

  const audit = await findAuditEntry({
    guild: channel.guild,
    type: AuditLogEvent.ChannelDelete,
    targetId: channel.id,
  });

  await emitServer(
    ctx,
    channel.guild,
    logEmbed({
      title: 'Canal apagado',
      tone: 'delete',
      // A menção viraria "#deleted-channel": o nome é a única pista que sobra.
      description: sentence(
        `${actor(audit.executor)} apagou o canal de ${channelTypeLabel(channel.type)}`,
        `#${channel.name}`,
        reasonSuffix(audit.reason),
      ),
      fields: [
        { name: 'Canal', value: fieldValue(`#${channel.name}`), inline: true },
        { name: 'Tipo', value: channelTypeLabel(channel.type), inline: true },
        ...executorField(audit.executor, audit.reason),
      ],
      footer: logFooter(`CANAL: ${channel.id}`),
    }),
  );
});

export const channelUpdate = defineEvent(Events.ChannelUpdate, async (ctx, oldChannel, channel) => {
  if (isDm(channel) || isDm(oldChannel)) return;
  const config = await logsConfig(ctx, channel.guild.id);
  if (!config.enabled) return;

  const changes = channelChanges(oldChannel, channel);
  if (changes.length === 0) return;

  const audit = await findAuditEntry({
    guild: channel.guild,
    type: AuditLogEvent.ChannelUpdate,
    targetId: channel.id,
  });

  await emitServer(
    ctx,
    channel.guild,
    logEmbed({
      title: 'Canal editado',
      tone: 'update',
      description: sentence(
        `${actor(audit.executor)} editou ${channelMention(channel.id)}`,
        `(${changeLabels(changes)})`,
        reasonSuffix(audit.reason),
      ),
      fields: [
        { name: 'Canal', value: channelValue(channel.id, channel.name), inline: true },
        ...executorField(audit.executor, audit.reason),
        ...changes,
      ],
      footer: logFooter(`CANAL: ${channel.id}`),
    }),
  );
});

/** Só o que dá para comparar sem estourar 25 fields: nome, tópico, slowmode, NSFW. */
function channelChanges(
  before: NonThreadGuildBasedChannel,
  after: NonThreadGuildBasedChannel,
): APIEmbedField[] {
  const fields: APIEmbedField[] = [];
  if (before.name !== after.name) {
    fields.push({ name: 'Nome', value: `${before.name} → ${after.name}`, inline: false });
  }
  const beforeTopic = 'topic' in before ? before.topic : null;
  const afterTopic = 'topic' in after ? after.topic : null;
  if (beforeTopic !== afterTopic) {
    fields.push({ name: 'Tópico (antes)', value: fieldValue(beforeTopic), inline: false });
    fields.push({ name: 'Tópico (depois)', value: fieldValue(afterTopic), inline: false });
  }
  const beforeSlow = 'rateLimitPerUser' in before ? before.rateLimitPerUser : null;
  const afterSlow = 'rateLimitPerUser' in after ? after.rateLimitPerUser : null;
  if (beforeSlow !== afterSlow) {
    fields.push({
      name: 'Slowmode',
      value: `${beforeSlow ?? 0}s → ${afterSlow ?? 0}s`,
      inline: true,
    });
  }
  const beforeNsfw = 'nsfw' in before ? before.nsfw : null;
  const afterNsfw = 'nsfw' in after ? after.nsfw : null;
  if (beforeNsfw !== afterNsfw) {
    fields.push({
      name: 'NSFW',
      value: `${String(beforeNsfw)} → ${String(afterNsfw)}`,
      inline: true,
    });
  }
  return fields;
}

function isDm(channel: GuildBasedChannel | DMChannel): channel is DMChannel {
  return !('guild' in channel);
}

// ── cargos ──────────────────────────────────────────────────────────────────

export const roleCreate = defineEvent(Events.GuildRoleCreate, async (ctx, role) => {
  const config = await logsConfig(ctx, role.guild.id);
  if (!config.enabled) return;

  const audit = await findAuditEntry({
    guild: role.guild,
    type: AuditLogEvent.RoleCreate,
    targetId: role.id,
  });

  await emitServer(
    ctx,
    role.guild,
    logEmbed({
      title: 'Cargo criado',
      tone: 'create',
      description: sentence(
        `${actor(audit.executor)} criou o cargo ${roleMention(role.id)}`,
        reasonSuffix(audit.reason),
      ),
      fields: [
        { name: 'Cargo', value: roleValue(role.id, role.name), inline: true },
        ...executorField(audit.executor, audit.reason),
      ],
      footer: logFooter(`CARGO: ${role.id}`),
    }),
  );
});

export const roleDelete = defineEvent(Events.GuildRoleDelete, async (ctx, role) => {
  const config = await logsConfig(ctx, role.guild.id);
  if (!config.enabled) return;

  const audit = await findAuditEntry({
    guild: role.guild,
    type: AuditLogEvent.RoleDelete,
    targetId: role.id,
  });

  await emitServer(
    ctx,
    role.guild,
    logEmbed({
      title: 'Cargo apagado',
      tone: 'delete',
      // Cargo apagado não tem menção que resolva: sobra o nome.
      description: sentence(
        `${actor(audit.executor)} apagou o cargo ${role.name}`,
        reasonSuffix(audit.reason),
      ),
      fields: [
        { name: 'Cargo', value: fieldValue(role.name), inline: true },
        ...executorField(audit.executor, audit.reason),
      ],
      footer: logFooter(`CARGO: ${role.id}`),
    }),
  );
});

export const roleUpdate = defineEvent(Events.GuildRoleUpdate, async (ctx, oldRole, role) => {
  const config = await logsConfig(ctx, role.guild.id);
  if (!config.enabled) return;

  const changes = roleChanges(oldRole, role);
  if (changes.length === 0) return;

  const audit = await findAuditEntry({
    guild: role.guild,
    type: AuditLogEvent.RoleUpdate,
    targetId: role.id,
  });

  await emitServer(
    ctx,
    role.guild,
    logEmbed({
      title: 'Cargo editado',
      tone: 'update',
      description: sentence(
        `${actor(audit.executor)} editou o cargo ${roleMention(role.id)}`,
        `(${changeLabels(changes)})`,
        reasonSuffix(audit.reason),
      ),
      fields: [
        { name: 'Cargo', value: roleValue(role.id, role.name), inline: true },
        ...executorField(audit.executor, audit.reason),
        ...changes,
      ],
      footer: logFooter(`CARGO: ${role.id}`),
    }),
  );
});

function roleChanges(before: Role, after: Role): APIEmbedField[] {
  const fields: APIEmbedField[] = [];
  if (before.name !== after.name) {
    fields.push({ name: 'Nome', value: `${before.name} → ${after.name}`, inline: false });
  }
  if (before.hexColor !== after.hexColor) {
    fields.push({ name: 'Cor', value: `${before.hexColor} → ${after.hexColor}`, inline: true });
  }
  if (before.hoist !== after.hoist) {
    fields.push({
      name: 'Exibido separadamente',
      value: `${String(before.hoist)} → ${String(after.hoist)}`,
      inline: true,
    });
  }
  if (before.mentionable !== after.mentionable) {
    fields.push({
      name: 'Mencionável',
      value: `${String(before.mentionable)} → ${String(after.mentionable)}`,
      inline: true,
    });
  }
  if (before.permissions.bitfield !== after.permissions.bitfield) {
    const added = after.permissions.missing(before.permissions);
    const removed = before.permissions.missing(after.permissions);
    if (added.length > 0) {
      fields.push({ name: 'Permissões +', value: fieldValue(added.join(', ')), inline: false });
    }
    if (removed.length > 0) {
      fields.push({ name: 'Permissões −', value: fieldValue(removed.join(', ')), inline: false });
    }
  }
  return fields;
}

// ── emojis e servidor ───────────────────────────────────────────────────────

export const emojiCreate = defineEvent(Events.GuildEmojiCreate, async (ctx, emoji) => {
  const config = await logsConfig(ctx, emoji.guild.id);
  if (!config.enabled) return;

  await emitServer(
    ctx,
    emoji.guild,
    logEmbed({
      title: 'Emoji criado',
      tone: 'create',
      description: sentence(`O emoji :${emoji.name}: foi adicionado ao servidor`),
      fields: [
        { name: 'Emoji', value: `${emoji.toString()} ${fieldValue(emoji.name)}`, inline: true },
      ],
      footer: logFooter(`EMOJI: ${emoji.id}`),
    }),
  );
});

export const emojiDelete = defineEvent(Events.GuildEmojiDelete, async (ctx, emoji) => {
  const config = await logsConfig(ctx, emoji.guild.id);
  if (!config.enabled) return;

  await emitServer(
    ctx,
    emoji.guild,
    logEmbed({
      title: 'Emoji apagado',
      tone: 'delete',
      description: sentence(`O emoji :${emoji.name}: foi removido do servidor`),
      fields: [{ name: 'Emoji', value: fieldValue(emoji.name), inline: true }],
      footer: logFooter(`EMOJI: ${emoji.id}`),
    }),
  );
});

export const guildUpdate = defineEvent(Events.GuildUpdate, async (ctx, oldGuild, guild) => {
  const config = await logsConfig(ctx, guild.id);
  if (!config.enabled) return;

  const fields: APIEmbedField[] = [];
  if (oldGuild.name !== guild.name) {
    fields.push({ name: 'Nome', value: `${oldGuild.name} → ${guild.name}`, inline: false });
  }
  if (oldGuild.icon !== guild.icon) {
    fields.push({ name: 'Ícone', value: 'alterado', inline: true });
  }
  if (oldGuild.ownerId !== guild.ownerId) {
    fields.push({
      name: 'Dono',
      value: `<@${oldGuild.ownerId}> → <@${guild.ownerId}>`,
      inline: false,
    });
  }
  if (oldGuild.verificationLevel !== guild.verificationLevel) {
    fields.push({
      name: 'Nível de verificação',
      value: `${oldGuild.verificationLevel} → ${guild.verificationLevel}`,
      inline: true,
    });
  }
  if (fields.length === 0) return;

  const audit = await findAuditEntry({ guild, type: AuditLogEvent.GuildUpdate });

  await emitServer(
    ctx,
    guild,
    logEmbed({
      title: 'Servidor editado',
      tone: 'update',
      description: sentence(
        `${actor(audit.executor)} mudou as configurações do servidor`,
        `(${changeLabels(fields)})`,
        reasonSuffix(audit.reason),
      ),
      fields: [...executorField(audit.executor, audit.reason), ...fields],
      footer: logFooter(`SERVIDOR: ${guild.id}`),
    }),
  );
});
