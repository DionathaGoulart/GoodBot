import { UserFacingError } from '@goodbot/shared';
import { PermissionFlagsBits, SlashCommandBuilder, time, TimestampStyles } from 'discord.js';

import { RULE_TYPE_LABELS } from './shared';
import { defineCommand } from '../../lib/command';
import { botFooter, infoEmbed, successEmbed, warningEmbed } from '../../lib/embeds';

import type { CommandContext } from '../../lib/command';

const MIN_MINUTES = 1;
const MAX_MINUTES = 1_440;

async function status(ctx: CommandContext): Promise<void> {
  const state = ctx.automod.raid.get(ctx.guildId);
  const rules = (await ctx.automod.getRules(ctx.guildId)).filter(
    (loaded) => loaded.rule.type === 'raid',
  );

  const configured =
    rules.length > 0
      ? rules
          .map(
            (loaded) =>
              `${loaded.rule.enabled ? '✔' : '✖'} **${loaded.rule.name}** · ${
                RULE_TYPE_LABELS.raid
              }`,
          )
          .join('\n')
      : '_Nenhuma regra anti-raid cadastrada; `/raid on` só alerta._';

  await ctx.interaction.editReply({
    embeds: [
      state
        ? warningEmbed({
            title: 'Modo raid ativo',
            description: `Ativado ${state.source === 'manual' ? 'manualmente' : 'automaticamente'}.`,
            fields: [
              {
                name: 'Expira',
                value: time(new Date(state.until), TimestampStyles.RelativeTime),
                inline: true,
              },
              { name: 'Regras', value: configured, inline: false },
            ],
            footer: botFooter('ANTI-RAID'),
          })
        : infoEmbed(
            {
              title: 'Modo raid inativo',
              description: configured,
              footer: botFooter('ANTI-RAID'),
            },
            ctx.settings.embedColor,
          ),
    ],
  });
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('raid')
    .setDescription('Modo anti-raid do servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('on')
        .setDescription('Liga o modo raid manualmente')
        .addIntegerOption((option) =>
          option
            .setName('minutos')
            .setDescription('Duração (padrão: a da regra anti-raid)')
            .setMinValue(MIN_MINUTES)
            .setMaxValue(MAX_MINUTES),
        ),
    )
    .addSubcommand((sub) => sub.setName('off').setDescription('Desliga o modo raid'))
    .addSubcommand((sub) => sub.setName('status').setDescription('Mostra o estado do modo raid')),
  module: 'automod',
  level: 'admin',
  cooldown: 3,
  defer: true,
  ephemeral: true,
  help: 'Liga, desliga e consulta o modo anti-raid.',
  async execute(ctx) {
    const guild = ctx.interaction.guild;
    if (!guild) {
      throw new UserFacingError('Este comando só funciona dentro do servidor.', {
        code: 'NO_GUILD',
      });
    }

    switch (ctx.interaction.options.getSubcommand()) {
      case 'on': {
        const minutes = ctx.interaction.options.getInteger('minutos') ?? undefined;
        const active = await ctx.automod.enableRaidMode(guild, minutes);
        await ctx.interaction.editReply({
          embeds: [
            warningEmbed({
              title: 'Modo raid ativado',
              description:
                `Novas entradas serão tratadas pela regra anti-raid pelos próximos ` +
                `**${active} minuto(s)**.`,
              footer: botFooter('ANTI-RAID'),
            }),
          ],
        });
        return;
      }
      case 'off': {
        const wasActive = await ctx.automod.disableRaidMode(guild);
        await ctx.interaction.editReply({
          embeds: [
            successEmbed({
              title: 'Modo raid desativado',
              description: wasActive
                ? 'As entradas voltam ao normal.'
                : 'O modo raid já estava desligado.',
              footer: botFooter('ANTI-RAID'),
            }),
          ],
        });
        return;
      }
      default:
        return status(ctx);
    }
  },
});
