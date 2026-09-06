import {
  createTicketPanel,
  createTicketType,
  deleteTicketType,
  getTicketType,
  listTicketPanels,
  listTicketTypes,
} from '@cobot/db';
import { MessageTemplateSchema, UserFacingError } from '@cobot/shared';
import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { defineCommand } from '../../lib/command';
import { botFooter, code, infoEmbed, successEmbed } from '../../lib/embeds';
import { levelAtLeast } from '../../services/permissions';
import { openLimitFor } from '../../services/tickets';

import type { AutocompleteContext, CommandContext } from '../../lib/command';
import type { Ticket } from '@cobot/db';
import type { GuildMember, GuildTextBasedChannel } from 'discord.js';

/** Quem pode fechar/gerir: autor do ticket, suporte do tipo ou moderação. */
async function requireManage(ctx: CommandContext, ticket: Ticket): Promise<void> {
  if (levelAtLeast(ctx.level, 'mod')) return;
  if (ticket.userId === ctx.member.id) return;
  const type = ticket.typeId ? await getTicketType(ctx.db, ctx.guildId, ticket.typeId) : null;
  if (type?.supportRoleIds.some((id) => ctx.member.roles.cache.has(id))) return;
  throw new UserFacingError('Você não pode gerenciar este ticket.', { code: 'FORBIDDEN' });
}

/** O canal onde o comando rodou, quando ele é um ticket aberto. */
async function ticketHere(
  ctx: CommandContext,
): Promise<{ ticket: Ticket; channel: GuildTextBasedChannel }> {
  const channel = ctx.interaction.channel;
  if (!channel?.isTextBased() || channel.isDMBased()) {
    throw new UserFacingError('Use este comando dentro do canal do ticket.', {
      code: 'NOT_A_TICKET',
    });
  }
  const ticket = await ctx.tickets.requireTicketFor(channel.id);
  await requireManage(ctx, ticket);
  return { ticket, channel: channel as GuildTextBasedChannel };
}

function requireAdmin(ctx: CommandContext): void {
  if (levelAtLeast(ctx.level, 'admin')) return;
  throw new UserFacingError('Só a administração configura tickets.', { code: 'FORBIDDEN' });
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Tickets de atendimento')
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
    .addSubcommand((sub) =>
      sub
        .setName('close')
        .setDescription('Fecha o ticket deste canal')
        .addStringOption((option) =>
          option.setName('motivo').setDescription('Por que está fechando').setMaxLength(500),
        ),
    )
    .addSubcommand((sub) => sub.setName('claim').setDescription('Assume o ticket deste canal'))
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Dá acesso a alguém neste ticket')
        .addUserOption((option) =>
          option.setName('membro').setDescription('Quem entra').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Tira o acesso de alguém neste ticket')
        .addUserOption((option) =>
          option.setName('membro').setDescription('Quem sai').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('rename')
        .setDescription('Renomeia o canal do ticket')
        .addStringOption((option) =>
          option.setName('nome').setDescription('Novo nome').setMaxLength(90).setRequired(true),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('type')
        .setDescription('Tipos de ticket (administração)')
        .addSubcommand((sub) =>
          sub
            .setName('create')
            .setDescription('Cria um tipo de ticket')
            .addStringOption((option) =>
              option.setName('nome').setDescription('Nome do tipo').setMaxLength(60).setRequired(true),
            )
            .addChannelOption((option) =>
              option
                .setName('categoria')
                .setDescription('Categoria (ou canal, se usar threads) dos tickets')
                .addChannelTypes(ChannelType.GuildCategory, ChannelType.GuildText)
                .setRequired(true),
            )
            .addRoleOption((option) =>
              option.setName('suporte').setDescription('Cargo que atende este tipo'),
            )
            .addIntegerOption((option) =>
              option
                .setName('limite')
                .setDescription('Tickets abertos por usuário neste tipo')
                .setMinValue(1)
                .setMaxValue(20),
            ),
        )
        .addSubcommand((sub) => sub.setName('list').setDescription('Lista os tipos de ticket'))
        .addSubcommand((sub) =>
          sub
            .setName('delete')
            .setDescription('Apaga um tipo de ticket')
            .addStringOption((option) =>
              option
                .setName('tipo')
                .setDescription('Tipo a apagar')
                .setAutocomplete(true)
                .setRequired(true),
            ),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('panel')
        .setDescription('Painéis de abertura (administração)')
        .addSubcommand((sub) =>
          sub
            .setName('create')
            .setDescription('Cria o painel com os botões de abertura')
            .addChannelOption((option) =>
              option
                .setName('canal')
                .setDescription('Onde o painel fica')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true),
            )
            .addStringOption((option) =>
              option
                .setName('texto')
                .setDescription('Texto do painel')
                .setMaxLength(1_000)
                .setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('publish')
            .setDescription('Publica (ou reedita) um painel')
            .addStringOption((option) =>
              option
                .setName('painel')
                .setDescription('Painel a publicar')
                .setAutocomplete(true)
                .setRequired(true),
            )
            .addChannelOption((option) =>
              option
                .setName('canal')
                .setDescription('Publicar em outro canal')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
            ),
        ),
    ),
  module: 'tickets',
  level: 'member',
  cooldown: 3,
  defer: true,
  ephemeral: true,
  help: 'Abre, gerencia e fecha tickets de atendimento.',
  async autocomplete(ctx: AutocompleteContext) {
    const focused = ctx.interaction.options.getFocused(true);
    const needle = focused.value.toLowerCase();

    if (focused.name === 'tipo') {
      const types = await listTicketTypes(ctx.db, ctx.guildId);
      await ctx.interaction.respond(
        types
          .filter((type) => type.name.toLowerCase().includes(needle))
          .slice(0, 25)
          .map((type) => ({ name: type.name.slice(0, 100), value: type.id })),
      );
      return;
    }

    const panels = await listTicketPanels(ctx.db, ctx.guildId);
    await ctx.interaction.respond(
      panels.slice(0, 25).map((panel) => ({
        name: `#${panel.channelId} · ${panel.typeIds.length} tipo(s)`.slice(0, 100),
        value: panel.id,
      })),
    );
  },
  async execute(ctx) {
    await ctx.tickets.requireConfig(ctx.guildId);
    const group = ctx.interaction.options.getSubcommandGroup(false);
    const sub = ctx.interaction.options.getSubcommand();

    if (group === 'type') return handleType(ctx, sub);
    if (group === 'panel') return handlePanel(ctx, sub);

    if (sub === 'claim') {
      const { ticket, channel } = await ticketHere(ctx);
      const claimed = await ctx.tickets.claim(ticket, ctx.member.id);
      if (!claimed) {
        throw new UserFacingError(`Já foi assumido por <@${ticket.claimedBy ?? ''}>.`, {
          code: 'ALREADY_CLAIMED',
        });
      }
      await channel
        .send({
          embeds: [
            successEmbed({
              title: 'Ticket assumido',
              description: `${ctx.member} vai cuidar deste ticket.`,
              footer: botFooter(`TICKET #${claimed.number}`),
            }),
          ],
        })
        .catch(() => null);
      await ctx.interaction.editReply({ content: 'Ticket assumido.' });
      return;
    }

    if (sub === 'close') {
      const { ticket, channel } = await ticketHere(ctx);
      await ctx.tickets.close(channel, ticket, {
        actorId: ctx.member.id,
        reason: ctx.interaction.options.getString('motivo'),
      });
      await ctx.interaction.editReply({ content: 'Ticket fechado. O canal some em 10 segundos.' });
      return;
    }

    if (sub === 'rename') {
      const { channel } = await ticketHere(ctx);
      const name = await ctx.tickets.rename(channel, ctx.interaction.options.getString('nome', true));
      await ctx.interaction.editReply({ content: `Canal renomeado para ${code(name)}.` });
      return;
    }

    // `add` e `remove`
    const { ticket, channel } = await ticketHere(ctx);
    const user = ctx.interaction.options.getUser('membro', true);
    const member = await ctx.interaction.guild?.members.fetch(user.id).catch(() => null);
    if (!member) {
      throw new UserFacingError('Esse usuário não está no servidor.', { code: 'NOT_A_MEMBER' });
    }
    if (sub === 'remove' && member.id === ticket.userId) {
      throw new UserFacingError('O autor do ticket não pode ser removido; feche o ticket.', {
        code: 'CANNOT_REMOVE_AUTHOR',
      });
    }

    const included = sub === 'add';
    await ctx.tickets.setParticipant(channel, member as GuildMember, included);
    await ctx.interaction.editReply({
      content: included ? `${user} agora vê este ticket.` : `${user} perdeu o acesso a este ticket.`,
    });
  },
});

async function handleType(ctx: CommandContext, sub: string): Promise<void> {
  if (sub === 'list') {
    const config = await ctx.tickets.requireConfig(ctx.guildId);
    const types = await listTicketTypes(ctx.db, ctx.guildId);
    await ctx.interaction.editReply({
      embeds: [
        infoEmbed(
          {
            title: 'Tipos de ticket',
            description:
              types.length === 0
                ? 'Nenhum tipo ainda. Crie com `/ticket type create`.'
                : types
                    .map(
                      (type) =>
                        `${code(type.id)} · **${type.name}** · <#${type.categoryId}> · limite ${openLimitFor(type, config)}`,
                    )
                    .join('\n'),
            footer: botFooter(`${types.length} TIPO(S)`),
          },
          ctx.settings.embedColor,
        ),
      ],
    });
    return;
  }

  requireAdmin(ctx);

  if (sub === 'delete') {
    const removed = await deleteTicketType(
      ctx.db,
      ctx.guildId,
      ctx.interaction.options.getString('tipo', true),
    );
    if (!removed) {
      throw new UserFacingError('Tipo não encontrado.', { code: 'TYPE_NOT_FOUND' });
    }
    await ctx.interaction.editReply({
      embeds: [
        successEmbed({
          title: 'Tipo apagado',
          description: `O tipo **${removed.name}** não existe mais. Tickets antigos continuam.`,
          footer: botFooter(),
        }),
      ],
    });
    return;
  }

  const category = ctx.interaction.options.getChannel('categoria', true);
  const support = ctx.interaction.options.getRole('suporte');
  const created = await createTicketType(ctx.db, {
    guildId: ctx.guildId,
    name: ctx.interaction.options.getString('nome', true).trim(),
    categoryId: category.id,
    supportRoleIds: support ? [support.id] : [],
    maxOpenPerUser: ctx.interaction.options.getInteger('limite'),
  });
  if (!created) {
    throw new UserFacingError('Já existe um tipo com esse nome.', { code: 'TYPE_EXISTS' });
  }

  await ctx.interaction.editReply({
    embeds: [
      successEmbed({
        title: 'Tipo criado',
        description: 'Inclua-o num painel com `/ticket panel create`.',
        fields: [
          { name: 'Tipo', value: code(created.id) },
          { name: 'Nome', value: created.name, inline: true },
          { name: 'Destino', value: `<#${created.categoryId}>`, inline: true },
          { name: 'Suporte', value: support ? `${support}` : '—', inline: true },
        ],
        footer: botFooter(),
      }),
    ],
  });
}

async function handlePanel(ctx: CommandContext, sub: string): Promise<void> {
  requireAdmin(ctx);
  const guild = ctx.interaction.guild;
  if (!guild) throw new UserFacingError('Comando só disponível no servidor.', { code: 'NO_GUILD' });

  if (sub === 'create') {
    const types = await listTicketTypes(ctx.db, ctx.guildId);
    if (types.length === 0) {
      throw new UserFacingError('Crie um tipo antes com `/ticket type create`.', {
        code: 'NO_TYPES',
      });
    }
    const channel = ctx.interaction.options.getChannel('canal', true);
    const panel = await createTicketPanel(ctx.db, {
      guildId: ctx.guildId,
      channelId: channel.id,
      content: MessageTemplateSchema.parse({
        content: ctx.interaction.options.getString('texto', true),
      }),
      // Um painel por servidor é o caso comum; o editor da Etapa 15 escolhe.
      typeIds: types.map((type) => type.id),
    });

    await ctx.interaction.editReply({
      embeds: [
        successEmbed({
          title: 'Painel criado',
          description: `Publique com \`/ticket panel publish painel:${panel.id}\`.`,
          fields: [
            { name: 'Painel', value: code(panel.id) },
            { name: 'Tipos', value: String(panel.typeIds.length), inline: true },
          ],
          footer: botFooter(),
        }),
      ],
    });
    return;
  }

  const messageId = await ctx.tickets.publishPanel(
    guild,
    ctx.interaction.options.getString('painel', true),
    ctx.interaction.options.getChannel('canal')?.id,
  );
  await ctx.interaction.editReply({
    embeds: [
      successEmbed({
        title: 'Painel publicado',
        description: 'Os botões de abertura já funcionam.',
        fields: [{ name: 'Mensagem', value: code(messageId), inline: true }],
        footer: botFooter(),
      }),
    ],
  });
}
