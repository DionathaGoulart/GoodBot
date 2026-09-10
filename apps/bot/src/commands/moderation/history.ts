import { countCasesForTarget, listCasesForTarget } from '@goodbot/db';
import { CASE_TYPES, MINUTE_MS } from '@goodbot/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import { addUserOption } from './shared';
import { CASE_TYPE_LABELS, caseLine } from '../../lib/case-embed';
import { defineCommand } from '../../lib/command';
import { botFooter, code, infoEmbed } from '../../lib/embeds';

import type { CommandContext } from '../../lib/command';
import type { Case } from '@goodbot/db';
import type { CaseType } from '@goodbot/shared';
import type { User } from 'discord.js';

const PAGE_SIZE = 5;
/** Os botões morrem em 2 min — depois disso o comando é barato de repetir. */
const COLLECTOR_MS = 2 * MINUTE_MS;

const PREV_ID = 'history:prev';
const NEXT_ID = 'history:next';

const data = new SlashCommandBuilder()
  .setName('history')
  .setDescription('Histórico de casos de um usuário')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);
addUserOption(data, 'De quem é o histórico');
data
  .addStringOption((option) =>
    option
      .setName('tipo')
      .setDescription('Filtra por tipo de caso')
      .addChoices(...CASE_TYPES.map((type) => ({ name: CASE_TYPE_LABELS[type], value: type }))),
  )
  .addIntegerOption((option) =>
    option.setName('pagina').setDescription('Página inicial').setMinValue(1),
  );

function buildEmbed(
  ctx: CommandContext,
  target: User,
  rows: Case[],
  page: number,
  pages: number,
  total: number,
  type: CaseType | null,
): ReturnType<typeof infoEmbed> {
  const filter = type ? ` · FILTRO: ${CASE_TYPE_LABELS[type]}` : '';
  return infoEmbed(
    {
      title: `Histórico de ${target.tag}`,
      description:
        rows.length > 0
          ? rows.map(caseLine).join('\n')
          : 'Nenhum caso registrado com esses critérios.',
      fields: [{ name: 'Usuário', value: `<@${target.id}> ${code(target.id)}`, inline: false }],
      footer: botFooter(`PÁGINA ${page}/${pages} · ${total} CASO(S)${filter}`),
    },
    ctx.settings.embedColor,
  );
}

function buildButtons(page: number, pages: number): ActionRowBuilder<ButtonBuilder>[] {
  if (pages <= 1) return [];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(PREV_ID)
        .setLabel('◀ ANTERIOR')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1),
      new ButtonBuilder()
        .setCustomId(NEXT_ID)
        .setLabel('PRÓXIMA ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pages),
    ),
  ];
}

export default defineCommand({
  data,
  module: 'moderation',
  level: 'mod',
  defer: true,
  ephemeral: true,
  cooldown: 3,
  help: 'Lista paginada dos casos de um usuário.',
  async execute(ctx) {
    const { interaction, db, guildId } = ctx;
    const target = interaction.options.getUser('usuario', true);
    const type = interaction.options.getString('tipo') as CaseType | null;

    const total = await countCasesForTarget(db, guildId, target.id, { type: type ?? undefined });
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    let page = Math.min(Math.max(interaction.options.getInteger('pagina') ?? 1, 1), pages);

    const load = (current: number) =>
      listCasesForTarget(db, guildId, target.id, {
        type: type ?? undefined,
        limit: PAGE_SIZE,
        offset: (current - 1) * PAGE_SIZE,
      });

    const render = async (current: number) => ({
      embeds: [buildEmbed(ctx, target, await load(current), current, pages, total, type)],
      components: buildButtons(current, pages),
    });

    const message = await interaction.editReply(await render(page));
    if (pages <= 1) return;

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: COLLECTOR_MS,
      // Só quem pediu navega; os outros nem veem, mas o filtro é barato.
      filter: (button) => button.user.id === interaction.user.id,
    });

    collector.on('collect', (button) => {
      page = button.customId === PREV_ID ? page - 1 : page + 1;
      page = Math.min(Math.max(page, 1), pages);
      void render(page)
        .then((payload) => button.update(payload))
        .catch((error: unknown) => {
          ctx.logger.error({ err: error, command: 'history' }, 'falha ao paginar o histórico');
        });
    });

    collector.on('end', () => {
      // Botões mortos confundem: somem quando o coletor expira.
      void interaction.editReply({ components: [] }).catch(() => undefined);
    });
  },
});
