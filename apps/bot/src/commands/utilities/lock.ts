import { scheduleAction } from '@goodbot/db';
import { DEFAULT_REASON, UserFacingError, formatDuration } from '@goodbot/shared';
import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { addChannelOption, requireUtilities, resolveChannel } from './shared';
import { defineCommand } from '../../lib/command';
import { botFooter, code, successEmbed } from '../../lib/embeds';
import { logEmbed } from '../../lib/log-embeds';
import { announceLock, isLockable } from '../../services/locks';
import { readDuration } from '../moderation/shared';

import type { CommandContext } from '../../lib/command';
import type { LockableChannel } from '../../services/locks';
import type { UtilitiesConfig } from '@goodbot/shared';
import type { Guild } from 'discord.js';

/** `@everyone` (o id da guild) mais os cargos configurados. */
function lockRoleIds(guildId: string, config: UtilitiesConfig): string[] {
  return [guildId, ...config.lock.extraRoleIds.filter((id) => id !== guildId)];
}

/** Canais que o `/lockdown` alcança: a lista fixa mais o conteúdo das categorias. */
function lockdownChannels(guild: Guild, config: UtilitiesConfig): LockableChannel[] {
  const ids = new Set(config.lock.lockdownChannelIds);
  for (const categoryId of config.lock.lockdownCategoryIds) {
    const category = guild.channels.cache.get(categoryId);
    if (category?.type !== ChannelType.GuildCategory) continue;
    for (const child of category.children.cache.values()) ids.add(child.id);
  }
  const channels: LockableChannel[] = [];
  for (const id of ids) {
    const channel = guild.channels.cache.get(id);
    if (isLockable(channel)) channels.push(channel);
  }
  return channels;
}

async function modlogLock(
  ctx: CommandContext,
  action: 'Canal trancado' | 'Canal destrancado' | 'Lockdown',
  description: string,
  reason: string,
): Promise<void> {
  await ctx.modlog.postAction(ctx.guildId, {
    embeds: [
      logEmbed({
        title: action,
        tone: action === 'Canal destrancado' ? 'create' : 'delete',
        description,
        fields: [
          { name: 'Moderador', value: `<@${ctx.member.id}>\n${code(ctx.member.id)}`, inline: true },
          { name: 'Motivo', value: reason, inline: true },
        ],
      }),
    ],
  });
}

const lockBuilder = new SlashCommandBuilder()
  .setName('lock')
  .setDescription('Tranca um canal: ninguém além da equipe fala nele')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  .addStringOption((option) =>
    option.setName('motivo').setDescription('Aparece no aviso do canal e no mod-log'),
  )
  .addStringOption((option) =>
    option.setName('duracao').setDescription('Destranca sozinho depois disso (ex.: 30m, 2h)'),
  );
addChannelOption(lockBuilder);

export const lock = defineCommand({
  data: lockBuilder,
  module: 'utilities',
  level: 'mod',
  cooldown: 3,
  defer: true,
  ephemeral: true,
  help: 'Tranca um canal, opcionalmente por tempo determinado.',
  async execute(ctx) {
    const config = await requireUtilities(ctx);
    const channel = resolveChannel(ctx.interaction);
    const reason = ctx.interaction.options.getString('motivo') ?? DEFAULT_REASON;
    const durationMs = readDuration(ctx.interaction);

    const outcome = await ctx.locks.lock({
      guildId: ctx.guildId,
      channel,
      roleIds: lockRoleIds(ctx.guildId, config),
      actorId: ctx.member.id,
      reason,
    });

    if (outcome === 'already-locked') {
      throw new UserFacingError(`<#${channel.id}> já está trancado.`, { code: 'ALREADY_LOCKED' });
    }

    if (durationMs) {
      await scheduleAction(ctx.db, {
        guildId: ctx.guildId,
        kind: 'unlock',
        runAt: new Date(Date.now() + durationMs),
        payload: { channelId: channel.id },
      });
    }

    const until = durationMs ? ` por ${formatDuration(durationMs, { style: 'long' })}` : '';
    await ctx.interaction.editReply({
      embeds: [
        successEmbed({
          title: 'Canal trancado',
          description: `<#${channel.id}> trancado${until}.\n**Motivo:** ${reason}`,
          footer: botFooter('LOCK'),
        }),
      ],
    });

    await announceLock(channel, {
      locked: true,
      reason,
      embedColor: ctx.settings.embedColor,
      announce: config.lock.announceInChannel,
    });
    await modlogLock(ctx, 'Canal trancado', `<#${channel.id}>${until}`, reason);
  },
});

const unlockBuilder = new SlashCommandBuilder()
  .setName('unlock')
  .setDescription('Destranca um canal, restaurando as permissões anteriores')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  .addStringOption((option) => option.setName('motivo').setDescription('Aparece no mod-log'));
addChannelOption(unlockBuilder);

export const unlock = defineCommand({
  data: unlockBuilder,
  module: 'utilities',
  level: 'mod',
  cooldown: 3,
  defer: true,
  ephemeral: true,
  help: 'Destranca um canal e devolve exatamente as permissões de antes.',
  async execute(ctx) {
    const config = await requireUtilities(ctx);
    const channel = resolveChannel(ctx.interaction);
    const reason = ctx.interaction.options.getString('motivo') ?? DEFAULT_REASON;

    const outcome = await ctx.locks.unlock({ guildId: ctx.guildId, channel, reason });
    if (outcome === 'not-locked') {
      throw new UserFacingError(`<#${channel.id}> não está trancado por mim.`, {
        code: 'NOT_LOCKED',
      });
    }

    await ctx.interaction.editReply({
      embeds: [
        successEmbed({
          title: 'Canal destrancado',
          description: `<#${channel.id}> voltou às permissões de antes do lock.`,
          footer: botFooter('LOCK'),
        }),
      ],
    });

    await announceLock(channel, {
      locked: false,
      reason,
      embedColor: ctx.settings.embedColor,
      announce: config.lock.announceInChannel,
    });
    await modlogLock(ctx, 'Canal destrancado', `<#${channel.id}>`, reason);
  },
});

export const lockdown = defineCommand({
  data: new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Tranca (ou destranca) todos os canais configurados de uma vez')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('on')
        .setDescription('Tranca os canais do lockdown')
        .addStringOption((option) =>
          option.setName('motivo').setDescription('Aparece no aviso e no mod-log'),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('off')
        .setDescription('Destranca os canais do lockdown')
        .addStringOption((option) => option.setName('motivo').setDescription('Aparece no mod-log')),
    ),
  module: 'utilities',
  level: 'admin',
  cooldown: 10,
  defer: true,
  ephemeral: true,
  help: 'Tranca ou destranca em massa os canais configurados no lockdown.',
  async execute(ctx) {
    const config = await requireUtilities(ctx);
    const guild = ctx.interaction.guild;
    if (!guild) {
      throw new UserFacingError('Este comando só funciona dentro do servidor.', {
        code: 'NO_GUILD',
      });
    }

    const on = ctx.interaction.options.getSubcommand() === 'on';
    const reason = ctx.interaction.options.getString('motivo') ?? DEFAULT_REASON;
    const channels = on ? lockdownChannels(guild, config) : [];

    // No `off` o alvo é o que está trancado de fato, e não a lista configurada:
    // um canal tirado da config depois do lock também precisa voltar.
    const targets = on
      ? channels
      : (await ctx.locks.list(ctx.guildId))
          .map((row) => guild.channels.cache.get(row.channelId))
          .filter((channel): channel is LockableChannel => isLockable(channel));

    if (targets.length === 0) {
      throw new UserFacingError(
        on
          ? 'Nenhum canal configurado para o lockdown. Configure em `/config` ou no painel.'
          : 'Nenhum canal trancado por mim.',
        { code: 'LOCKDOWN_EMPTY' },
      );
    }

    const roleIds = lockRoleIds(ctx.guildId, config);
    let changed = 0;
    const failures: string[] = [];

    for (const channel of targets) {
      try {
        const outcome = on
          ? await ctx.locks.lock({
              guildId: ctx.guildId,
              channel,
              roleIds,
              actorId: ctx.member.id,
              reason,
            })
          : await ctx.locks.unlock({ guildId: ctx.guildId, channel, reason });
        if (outcome === 'locked' || outcome === 'unlocked') {
          changed += 1;
          await announceLock(channel, {
            locked: on,
            reason,
            embedColor: ctx.settings.embedColor,
            announce: config.lock.announceInChannel,
          });
        }
      } catch (error) {
        failures.push(`<#${channel.id}>`);
        ctx.logger.warn({ err: error, channelId: channel.id }, 'falha no lockdown');
      }
    }

    const fields = [
      { name: on ? 'Trancados' : 'Destrancados', value: `${changed}`, inline: true },
      { name: 'Alvos', value: `${targets.length}`, inline: true },
    ];
    if (failures.length > 0) {
      fields.push({ name: 'Falharam', value: failures.slice(0, 10).join(' '), inline: false });
    }

    await ctx.interaction.editReply({
      embeds: [
        successEmbed({
          title: on ? 'Lockdown ativado' : 'Lockdown desfeito',
          description: `**Motivo:** ${reason}`,
          fields,
          footer: botFooter('LOCKDOWN'),
        }),
      ],
    });

    await modlogLock(
      ctx,
      'Lockdown',
      `${on ? 'Trancados' : 'Destrancados'} ${changed} de ${targets.length} canal(is).`,
      reason,
    );
  },
});
