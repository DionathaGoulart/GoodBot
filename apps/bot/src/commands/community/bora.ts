import { describeWhen, parseWhen, suggestWhen, UserFacingError } from '@goodbot/shared';
import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { pickSquad } from './squad';
import { defineCommand } from '../../lib/command';
import { sessionScheduledText } from '../../services/squads/embeds';
import { boraModal } from '../../services/squads/forms';

import type { AutocompleteContext } from '../../lib/command';

/** Teto do Discord para as sugestões e para o nome de uma sugestão. */
const MAX_CHOICES = 25;
const MAX_CHOICE_NAME = 100;
/** Teto do "quando": o mesmo do campo do modal. */
const MAX_WHEN_LENGTH = 40;

/**
 * O autocomplete do "quando": vazio, as sugestões que valem agora; digitado,
 * o eco do que o bot entendeu ("sex 22h → sexta 18/09 às 22:00"), para o erro
 * aparecer antes de enviar. O valor é sempre o texto digitado: o `execute`
 * lê de novo, com o relógio da hora do envio.
 */
export function whenChoices(
  typed: string,
  now: Date,
  timeZone: string,
): { name: string; value: string }[] {
  const text = typed.trim().slice(0, MAX_WHEN_LENGTH);
  const describe = (input: string) => {
    try {
      return `${input} → ${describeWhen(parseWhen(input, now, timeZone), now, timeZone)}`;
    } catch (error) {
      return error instanceof UserFacingError ? `${input} → ${error.message}` : input;
    }
  };
  const inputs = text ? [text] : suggestWhen(now, timeZone);
  return inputs
    .slice(0, MAX_CHOICES)
    .map((input) => ({ name: describe(input).slice(0, MAX_CHOICE_NAME), value: input }));
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('bora')
    .setDescription('Marca uma jogatina do seu squad e chama o grupo')
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
    .addStringOption((option) =>
      option
        .setName('quando')
        .setDescription('agora, hoje 21h, amanhã 20:30, sex 22h')
        .setMaxLength(MAX_WHEN_LENGTH)
        .setAutocomplete(true),
    )
    .addStringOption((option) =>
      option.setName('squad').setDescription('Qual squad chamar').setAutocomplete(true),
    ),
  module: 'squads',
  level: 'member',
  cooldown: 5,
  ephemeral: true,
  // Sem "quando", responde com o modal do BORA; com, adia por conta própria.
  opensModal: true,
  help: 'Marca uma jogatina do seu squad: eu chamo o grupo e reservo uma sala.',
  async autocomplete(ctx: AutocompleteContext) {
    const focused = ctx.interaction.options.getFocused(true);
    if (focused.name === 'quando') {
      await ctx.interaction.respond(whenChoices(focused.value, new Date(), ctx.settings.timezone));
      return;
    }
    const needle = focused.value.toLowerCase();
    const squads = await ctx.squads.listSquadsForUser(ctx.guildId, ctx.interaction.user.id);
    await ctx.interaction.respond(
      squads
        .filter((squad) => squad.name.toLowerCase().includes(needle))
        .slice(0, MAX_CHOICES)
        .map((squad) => ({ name: squad.name.slice(0, MAX_CHOICE_NAME), value: squad.id })),
    );
  },
  async execute(ctx) {
    const guild = ctx.interaction.guild;
    if (!guild) throw new UserFacingError('Comando só disponível no servidor.', { code: 'NO_GUILD' });
    await ctx.squads.requireConfig(ctx.guildId);
    const squad = pickSquad(
      await ctx.squads.listSquadsForUser(ctx.guildId, ctx.member.id),
      ctx.interaction.options.getString('squad'),
      ctx.interaction.channelId,
    );

    const when = ctx.interaction.options.getString('quando')?.trim();
    if (!when) {
      await ctx.interaction.showModal(boraModal(squad));
      return;
    }
    await ctx.interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await ctx.squads.scheduleSession(guild, squad.id, ctx.member.id, when, 'command');
    await ctx.interaction.editReply({ content: sessionScheduledText(result) });
  },
});
