import { formatDuration } from '@cobot/shared';
import { AuditLogEvent, Events, time, TimestampStyles } from 'discord.js';

import { findAuditEntry } from '../../lib/audit-log';
import { defineEvent } from '../../lib/event';
import { executorField, logEmbed, logFooter, roleMentions, userValue } from '../../lib/log-embeds';
import { fieldValue } from '../../services/logs';

import type { BotContext } from '../../lib/command';
import type { LogsConfig } from '@cobot/shared';
import type { APIEmbedField, GuildMember, PartialGuildMember } from 'discord.js';

async function logsConfig(ctx: BotContext, guildId: string): Promise<LogsConfig> {
  return ctx.config.get(guildId, 'logs');
}

function memberRoleIds(member: GuildMember | PartialGuildMember): string[] {
  return [...member.roles.cache.keys()];
}

export const guildMemberAdd = defineEvent(Events.GuildMemberAdd, async (ctx, member) => {
  const config = await logsConfig(ctx, member.guild.id);
  if (!config.enabled) return;

  const created = member.user.createdAt;
  const embed = logEmbed({
    title: 'Membro entrou',
    tone: 'create',
    fields: [
      { name: 'Usuário', value: userValue(member.user), inline: true },
      { name: 'Membros', value: String(member.guild.memberCount), inline: true },
      {
        name: 'Conta criada',
        value: `${time(created, TimestampStyles.ShortDate)} (${formatDuration(
          Date.now() - created.getTime(),
          { style: 'long', maxUnits: 2 },
        )})`,
        inline: false,
      },
    ],
    footer: logFooter(`USUÁRIO: ${member.id}`),
  });

  await ctx.logs.emit(member.guild.id, 'members', { embeds: [embed] });
});

export const guildMemberRemove = defineEvent(Events.GuildMemberRemove, async (ctx, member) => {
  const config = await logsConfig(ctx, member.guild.id);
  if (!config.enabled) return;

  const roles = memberRoleIds(member).filter((id) => id !== member.guild.id);
  const fields: APIEmbedField[] = [
    { name: 'Usuário', value: userValue(member.user), inline: true },
    { name: 'Membros', value: String(member.guild.memberCount), inline: true },
  ];
  if (member.joinedAt) {
    fields.push({
      name: 'Tempo no servidor',
      value: formatDuration(Date.now() - member.joinedAt.getTime(), { style: 'long', maxUnits: 2 }),
      inline: false,
    });
  }
  fields.push({ name: 'Cargos', value: fieldValue(roleMentions(roles)), inline: false });

  const embed = logEmbed({
    title: 'Membro saiu',
    tone: 'delete',
    fields,
    footer: logFooter(`USUÁRIO: ${member.id}`),
  });

  await ctx.logs.emit(member.guild.id, 'members', { embeds: [embed] }, { roleIds: roles });
});

/**
 * Nick, cargos e avatar chegam no mesmo evento. O Discord não diz quem fez a
 * mudança — quem descobre é o audit log, com o timeout curto de `findAuditEntry`.
 */
export const guildMemberUpdate = defineEvent(
  Events.GuildMemberUpdate,
  async (ctx, oldMember, newMember) => {
    const guildId = newMember.guild.id;
    const config = await logsConfig(ctx, guildId);
    if (!config.enabled) return;

    const roleIds = memberRoleIds(newMember);
    const embeds = [];

    if (oldMember.nickname !== newMember.nickname) {
      const audit = await findAuditEntry({
        guild: newMember.guild,
        type: AuditLogEvent.MemberUpdate,
        targetId: newMember.id,
      });
      embeds.push(
        logEmbed({
          title: 'Apelido alterado',
          tone: 'update',
          fields: [
            { name: 'Usuário', value: userValue(newMember.user), inline: true },
            ...executorField(audit.executor, audit.reason),
            { name: 'Antes', value: fieldValue(oldMember.nickname), inline: false },
            { name: 'Depois', value: fieldValue(newMember.nickname), inline: false },
          ],
          footer: logFooter(`USUÁRIO: ${newMember.id}`),
        }),
      );
    }

    const before = memberRoleIds(oldMember);
    const added = roleIds.filter((id) => !before.includes(id));
    const removed = before.filter((id) => !roleIds.includes(id));
    if (added.length > 0 || removed.length > 0) {
      const audit = await findAuditEntry({
        guild: newMember.guild,
        type: AuditLogEvent.MemberRoleUpdate,
        targetId: newMember.id,
      });
      const fields: APIEmbedField[] = [
        { name: 'Usuário', value: userValue(newMember.user), inline: true },
        ...executorField(audit.executor, audit.reason),
      ];
      if (added.length > 0) {
        fields.push({ name: 'Adicionados', value: roleMentions(added), inline: false });
      }
      if (removed.length > 0) {
        fields.push({ name: 'Removidos', value: roleMentions(removed), inline: false });
      }
      embeds.push(
        logEmbed({
          title: 'Cargos alterados',
          tone: 'update',
          fields,
          footer: logFooter(`USUÁRIO: ${newMember.id}`),
        }),
      );
    }

    if (config.logAvatarChanges && oldMember.avatar !== newMember.avatar) {
      embeds.push(
        logEmbed({
          title: 'Avatar do servidor alterado',
          tone: 'update',
          fields: [{ name: 'Usuário', value: userValue(newMember.user), inline: true }],
          footer: logFooter(`USUÁRIO: ${newMember.id}`),
        }),
      );
    }

    for (const embed of embeds) {
      await ctx.logs.emit(guildId, 'members', { embeds: [embed] }, { roleIds });
    }
  },
);

/**
 * Ban/unban feitos fora do bot. Quando o executor é o próprio CoBot o caso já
 * foi para o mod-log, e repetir aqui duplicaria o registro (PRD §5.4).
 */
export const guildBanAdd = defineEvent(Events.GuildBanAdd, async (ctx, ban) => {
  const config = await logsConfig(ctx, ban.guild.id);
  if (!config.enabled) return;

  const audit = await findAuditEntry({
    guild: ban.guild,
    type: AuditLogEvent.MemberBanAdd,
    targetId: ban.user.id,
  });
  if (audit.executor?.id === ctx.client.user?.id) return;

  const embed = logEmbed({
    title: 'Usuário banido (fora do bot)',
    tone: 'delete',
    fields: [
      { name: 'Usuário', value: userValue(ban.user), inline: true },
      ...executorField(audit.executor, audit.reason ?? ban.reason),
    ],
    footer: logFooter(`USUÁRIO: ${ban.user.id}`),
  });

  await ctx.logs.emit(ban.guild.id, 'members', { embeds: [embed] });
});

export const guildBanRemove = defineEvent(Events.GuildBanRemove, async (ctx, ban) => {
  const config = await logsConfig(ctx, ban.guild.id);
  if (!config.enabled) return;

  const audit = await findAuditEntry({
    guild: ban.guild,
    type: AuditLogEvent.MemberBanRemove,
    targetId: ban.user.id,
  });
  if (audit.executor?.id === ctx.client.user?.id) return;

  const embed = logEmbed({
    title: 'Usuário desbanido (fora do bot)',
    tone: 'create',
    fields: [
      { name: 'Usuário', value: userValue(ban.user), inline: true },
      ...executorField(audit.executor, audit.reason),
    ],
    footer: logFooter(`USUÁRIO: ${ban.user.id}`),
  });

  await ctx.logs.emit(ban.guild.id, 'members', { embeds: [embed] });
});
