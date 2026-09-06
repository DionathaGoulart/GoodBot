import {
  cancelReminder,
  countPendingReminders,
  createReminder,
  listPendingReminders,
  scheduleAction,
} from '@cobot/db';
import { MAX_MESSAGE_CONTENT_LENGTH, UserFacingError, formatDuration } from '@cobot/shared';
import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  time,
  TimestampStyles,
} from 'discord.js';

import { requireUtilities } from './shared';
import { defineCommand } from '../../lib/command';
import { botFooter, code, infoEmbed, successEmbed } from '../../lib/embeds';
import { readDuration } from '../moderation/shared';

/** Texto do lembrete: cabe numa mensagem, com folga para o cabeçalho. */
const MAX_TEXT_LENGTH = 1_000;

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Lembretes pessoais')
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Cria um lembrete')
        .addStringOption((option) =>
          option
            .setName('duracao')
            .setDescription('Daqui a quanto tempo (ex.: 10m, 2h, 3d)')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('texto')
            .setDescription('O que lembrar')
            .setMaxLength(MAX_TEXT_LENGTH)
            .setRequired(true),
        )
        .addBooleanOption((option) =>
          option
            .setName('no_canal')
            .setDescription('Avisar neste canal em vez de na DM (padrão: DM)'),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('Lista seus lembretes pendentes'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('cancel')
        .setDescription('Cancela um lembrete seu')
        .addIntegerOption((option) =>
          option
            .setName('id')
            .setDescription('O ID que aparece no /remind list')
            .setMinValue(1)
            .setRequired(true),
        ),
    ),
  module: 'utilities',
  level: 'member',
  cooldown: 3,
  defer: true,
  ephemeral: true,
  help: 'Cria, lista e cancela lembretes pessoais.',
  async execute(ctx) {
    const config = await requireUtilities(ctx);
    const sub = ctx.interaction.options.getSubcommand();

    if (sub === 'list') {
      const pending = await listPendingReminders(ctx.db, ctx.guildId, ctx.member.id);
      await ctx.interaction.editReply({
        embeds: [
          infoEmbed(
            {
              title: 'Seus lembretes',
              description:
                pending.length === 0
                  ? 'Você não tem lembretes pendentes.'
                  : pending
                      .map(
                        (reminder) =>
                          `${code(`#${reminder.id}`)} ${time(
                            reminder.runAt,
                            TimestampStyles.RelativeTime,
                          )} — ${reminder.text}`,
                      )
                      .join('\n'),
              footer: botFooter(`${pending.length} PENDENTE(S)`),
            },
            ctx.settings.embedColor,
          ),
        ],
      });
      return;
    }

    if (sub === 'cancel') {
      const id = ctx.interaction.options.getInteger('id', true);
      const cancelled = await cancelReminder(ctx.db, {
        guildId: ctx.guildId,
        userId: ctx.member.id,
        id,
      });
      if (!cancelled) {
        throw new UserFacingError(
          `Não achei um lembrete pendente seu com o ID \`${id}\`.`,
          { code: 'REMINDER_NOT_FOUND' },
        );
      }
      await ctx.interaction.editReply({
        embeds: [
          successEmbed({
            title: 'Lembrete cancelado',
            description: cancelled.text,
            footer: botFooter(`ID: ${cancelled.id}`),
          }),
        ],
      });
      return;
    }

    const durationMs = readDuration(ctx.interaction);
    if (!durationMs) {
      throw new UserFacingError('Informe a duração (ex.: `10m`, `2h`, `3d`).', {
        code: 'BAD_DURATION',
      });
    }
    if (durationMs > config.reminders.maxDurationMs) {
      throw new UserFacingError(
        `O prazo máximo aqui é ${formatDuration(config.reminders.maxDurationMs, {
          style: 'long',
        })}.`,
        { code: 'REMINDER_TOO_LONG' },
      );
    }

    const pending = await countPendingReminders(ctx.db, ctx.guildId, ctx.member.id);
    if (pending >= config.reminders.maxPerUser) {
      throw new UserFacingError(
        `Você já tem ${pending} lembretes pendentes (máx. ${config.reminders.maxPerUser}). ` +
          'Cancele algum com `/remind cancel`.',
        { code: 'REMINDER_LIMIT' },
      );
    }

    const inChannel = ctx.interaction.options.getBoolean('no_canal') ?? false;
    const runAt = new Date(Date.now() + durationMs);
    const reminder = await createReminder(ctx.db, {
      guildId: ctx.guildId,
      userId: ctx.member.id,
      channelId: inChannel ? ctx.interaction.channelId : null,
      text: ctx.interaction.options.getString('texto', true).slice(0, MAX_TEXT_LENGTH),
      runAt,
    });

    // O scheduler é a fonte de execução; a tabela guarda o conteúdo. Assim um
    // restart do bot não perde nada: as duas linhas já estão no banco.
    await scheduleAction(ctx.db, {
      guildId: ctx.guildId,
      kind: 'reminder',
      runAt,
      payload: { reminderId: reminder.id },
    });

    await ctx.interaction.editReply({
      embeds: [
        successEmbed({
          title: 'Lembrete criado',
          description: reminder.text.slice(0, MAX_MESSAGE_CONTENT_LENGTH),
          fields: [
            { name: 'Quando', value: time(runAt, TimestampStyles.RelativeTime), inline: true },
            { name: 'Onde', value: inChannel ? `<#${reminder.channelId}>` : 'DM', inline: true },
          ],
          footer: botFooter(`ID: ${reminder.id}`),
        }),
      ],
    });
  },
});
