import {
  addPanelItem,
  countItemsByPanel,
  countPanels,
  createPanel,
  deletePanel,
  getPanel,
  listPanels,
  removePanelItem,
} from '@cobot/db';
import { MessageTemplateSchema, UserFacingError } from '@cobot/shared';
import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { defineCommand } from '../../lib/command';
import { botFooter, code, infoEmbed, successEmbed } from '../../lib/embeds';
import {
  MAX_PANEL_ITEMS,
  parseEmojiInput,
  toEmojiIdentifier,
} from '../../services/reaction-roles';

import type { AutocompleteContext, CommandContext } from '../../lib/command';
import type { PanelWithItems, ReactionRolePanel } from '@cobot/db';
import type { ReactionRoleMode, ReactionRoleStyle } from '@cobot/shared';
import type { Role } from 'discord.js';

const MODE_LABEL: Record<ReactionRoleMode, string> = {
  single: 'único',
  multiple: 'múltiplo',
  toggle: 'toggle',
};

const STYLE_LABEL: Record<ReactionRoleStyle, string> = {
  buttons: 'botões',
  select: 'select',
  reactions: 'reações',
};

/** Linha do autocomplete/`list`: o UUID é ilegível, o resumo não. */
function panelSummary(panel: ReactionRolePanel, items: number): string {
  return `#${panel.channelId} · ${MODE_LABEL[panel.mode]}/${STYLE_LABEL[panel.style]} · ${items} cargo(s)`;
}

async function requirePanel(ctx: CommandContext, panelId: string): Promise<PanelWithItems> {
  const panel = await getPanel(ctx.db, ctx.guildId, panelId);
  if (!panel) {
    throw new UserFacingError('Painel não encontrado. Use `/reactionrole list`.', {
      code: 'PANEL_NOT_FOUND',
    });
  }
  return panel;
}

async function requireEnabled(ctx: CommandContext): Promise<void> {
  const config = await ctx.config.get(ctx.guildId, 'reaction_roles');
  if (!config.enabled) {
    throw new UserFacingError(
      'O módulo de reaction roles está desligado. Ligue-o no painel antes de publicar.',
      { code: 'MODULE_DISABLED' },
    );
  }
}

/** Republica o painel quando ele já tem mensagem — o clique precisa bater. */
async function refreshIfPublished(ctx: CommandContext, panel: PanelWithItems): Promise<void> {
  if (!panel.messageId || !ctx.interaction.guild) return;
  await ctx.reactionRoles.publishPanel(ctx.interaction.guild, panel.id).catch((error: unknown) => {
    ctx.logger.warn({ err: error, panelId: panel.id }, 'não foi possível atualizar o painel');
  });
}

/** O bot só dá cargos abaixo do seu mais alto e não gerenciados por integração. */
function assertAssignable(ctx: CommandContext, role: Role): void {
  const me = role.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new UserFacingError('Eu não tenho a permissão **Gerenciar cargos**.', {
      code: 'MISSING_PERMISSION',
    });
  }
  if (role.managed) {
    throw new UserFacingError(`${role} é gerenciado por uma integração e não pode ser dado.`, {
      code: 'MANAGED_ROLE',
    });
  }
  if (role.position >= me.roles.highest.position) {
    throw new UserFacingError(
      `${role} está acima do meu cargo mais alto. Suba meu cargo na hierarquia.`,
      { code: 'ROLE_HIERARCHY' },
    );
  }
  if (role.id === ctx.guildId) {
    throw new UserFacingError('`@everyone` não pode ser um cargo de painel.', {
      code: 'EVERYONE_ROLE',
    });
  }
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Painéis de cargo por botão, select ou reação')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Cria um painel vazio')
        .addChannelOption((option) =>
          option
            .setName('canal')
            .setDescription('Onde o painel será publicado')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('texto')
            .setDescription('Texto da mensagem do painel')
            .setMaxLength(1_000)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('modo')
            .setDescription('Como os cargos se comportam (padrão: toggle)')
            .addChoices(
              { name: 'único — só um cargo do painel por vez', value: 'single' },
              { name: 'múltiplo — só acumula', value: 'multiple' },
              { name: 'toggle — clicar de novo tira', value: 'toggle' },
            ),
        )
        .addStringOption((option) =>
          option
            .setName('estilo')
            .setDescription('Botões, select ou reações (padrão: botões)')
            .addChoices(
              { name: 'botões', value: 'buttons' },
              { name: 'select', value: 'select' },
              { name: 'reações', value: 'reactions' },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Adiciona um cargo ao painel')
        .addStringOption((option) =>
          option
            .setName('painel')
            .setDescription('Painel de destino')
            .setAutocomplete(true)
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option.setName('cargo').setDescription('Cargo oferecido').setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('rotulo').setDescription('Texto do botão/opção').setMaxLength(80),
        )
        .addStringOption((option) =>
          option.setName('emoji').setDescription('Emoji do botão/opção/reação').setMaxLength(64),
        )
        .addStringOption((option) =>
          option.setName('descricao').setDescription('Descrição (só no select)').setMaxLength(100),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Tira um cargo do painel')
        .addStringOption((option) =>
          option
            .setName('painel')
            .setDescription('Painel')
            .setAutocomplete(true)
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option.setName('cargo').setDescription('Cargo a tirar').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('publish')
        .setDescription('Publica (ou reedita) a mensagem do painel')
        .addStringOption((option) =>
          option
            .setName('painel')
            .setDescription('Painel')
            .setAutocomplete(true)
            .setRequired(true),
        )
        .addChannelOption((option) =>
          option
            .setName('canal')
            .setDescription('Publicar em outro canal')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Apaga o painel (a mensagem publicada continua)')
        .addStringOption((option) =>
          option
            .setName('painel')
            .setDescription('Painel')
            .setAutocomplete(true)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Lista os painéis do servidor')),
  module: 'reaction_roles',
  level: 'admin',
  cooldown: 3,
  defer: true,
  ephemeral: true,
  help: 'Cria, edita e publica painéis de cargo.',
  async autocomplete(ctx: AutocompleteContext) {
    const [panels, counts] = await Promise.all([
      listPanels(ctx.db, ctx.guildId),
      countItemsByPanel(ctx.db, ctx.guildId),
    ]);
    const needle = ctx.interaction.options.getFocused().toLowerCase();
    const options = panels.map((panel) => ({
      name: panelSummary(panel, counts.get(panel.id) ?? 0).slice(0, 100),
      value: panel.id,
    }));
    await ctx.interaction.respond(
      options.filter((option) => option.name.toLowerCase().includes(needle)).slice(0, 25),
    );
  },
  async execute(ctx) {
    const sub = ctx.interaction.options.getSubcommand();

    if (sub === 'list') {
      const [panels, counts] = await Promise.all([
        listPanels(ctx.db, ctx.guildId),
        countItemsByPanel(ctx.db, ctx.guildId),
      ]);
      const lines = panels.map((panel) => {
        const status = panel.messageId ? 'publicado' : 'não publicado';
        return `${code(panel.id)} · <#${panel.channelId}> · ${MODE_LABEL[panel.mode]}/${STYLE_LABEL[panel.style]} · ${counts.get(panel.id) ?? 0} cargo(s) · ${status}`;
      });
      await ctx.interaction.editReply({
        embeds: [
          infoEmbed(
            {
              title: 'Painéis de cargo',
              description:
                lines.length === 0
                  ? 'Nenhum painel ainda. Crie com `/reactionrole create`.'
                  : lines.join('\n'),
              footer: botFooter(`${panels.length} PAINEL(IS)`),
            },
            ctx.settings.embedColor,
          ),
        ],
      });
      return;
    }

    if (sub === 'create') {
      const config = await ctx.config.get(ctx.guildId, 'reaction_roles');
      const total = await countPanels(ctx.db, ctx.guildId);
      if (total >= config.maxPanels) {
        throw new UserFacingError(`Este servidor já tem ${total} painéis (máx. ${config.maxPanels}).`, {
          code: 'PANEL_LIMIT',
        });
      }

      const channel = ctx.interaction.options.getChannel('canal', true);
      const content = MessageTemplateSchema.parse({
        content: ctx.interaction.options.getString('texto', true),
      });
      const panel = await createPanel(ctx.db, {
        guildId: ctx.guildId,
        channelId: channel.id,
        mode: (ctx.interaction.options.getString('modo') ?? 'toggle') as ReactionRoleMode,
        style: (ctx.interaction.options.getString('estilo') ?? 'buttons') as ReactionRoleStyle,
        content,
      });

      await ctx.interaction.editReply({
        embeds: [
          successEmbed({
            title: 'Painel criado',
            description:
              `Adicione cargos com \`/reactionrole add painel:${panel.id}\` e ` +
              'publique com `/reactionrole publish`.',
            fields: [
              { name: 'Painel', value: code(panel.id) },
              { name: 'Canal', value: `<#${panel.channelId}>`, inline: true },
              { name: 'Modo', value: MODE_LABEL[panel.mode], inline: true },
              { name: 'Estilo', value: STYLE_LABEL[panel.style], inline: true },
            ],
            footer: botFooter(),
          }),
        ],
      });
      return;
    }

    const panel = await requirePanel(ctx, ctx.interaction.options.getString('painel', true));

    if (sub === 'delete') {
      await deletePanel(ctx.db, ctx.guildId, panel.id);
      await ctx.interaction.editReply({
        embeds: [
          successEmbed({
            title: 'Painel apagado',
            description:
              'A mensagem publicada continua no canal, mas os botões deixam de funcionar.',
            footer: botFooter(),
          }),
        ],
      });
      return;
    }

    if (sub === 'publish') {
      await requireEnabled(ctx);
      const guild = ctx.interaction.guild;
      if (!guild) throw new UserFacingError('Comando só disponível no servidor.', { code: 'NO_GUILD' });
      if (panel.items.length === 0) {
        throw new UserFacingError('Adicione ao menos um cargo antes de publicar.', {
          code: 'EMPTY_PANEL',
        });
      }

      const channel = ctx.interaction.options.getChannel('canal');
      const published = await ctx.reactionRoles.publishPanel(guild, panel.id, channel?.id);
      await ctx.interaction.editReply({
        embeds: [
          successEmbed({
            title: 'Painel publicado',
            description: `A mensagem está em <#${published.channelId}>.`,
            fields: [{ name: 'Mensagem', value: code(published.messageId ?? '—'), inline: true }],
            footer: botFooter(`${published.items.length} CARGO(S)`),
          }),
        ],
      });
      return;
    }

    const role = ctx.interaction.options.getRole('cargo', true) as Role;

    if (sub === 'remove') {
      const removed = await removePanelItem(ctx.db, panel.id, role.id);
      if (!removed) {
        throw new UserFacingError(`${role} não está neste painel.`, { code: 'ITEM_NOT_FOUND' });
      }
      await refreshIfPublished(ctx, await requirePanel(ctx, panel.id));
      await ctx.interaction.editReply({
        embeds: [
          successEmbed({
            title: 'Cargo removido',
            description: `${role} saiu do painel.`,
            footer: botFooter(),
          }),
        ],
      });
      return;
    }

    // `add`
    if (panel.items.length >= MAX_PANEL_ITEMS) {
      throw new UserFacingError(`Um painel aceita no máximo ${MAX_PANEL_ITEMS} cargos.`, {
        code: 'ITEM_LIMIT',
      });
    }
    assertAssignable(ctx, role);

    const rawEmoji = ctx.interaction.options.getString('emoji');
    const emoji = rawEmoji ? parseEmojiInput(rawEmoji) : null;
    if (rawEmoji && !emoji) {
      throw new UserFacingError('Não reconheci esse emoji. Use um emoji do teclado ou do servidor.', {
        code: 'BAD_EMOJI',
      });
    }
    if (panel.style === 'reactions' && !emoji) {
      throw new UserFacingError('Painéis de reação exigem um emoji em cada cargo.', {
        code: 'EMOJI_REQUIRED',
      });
    }

    const item = await addPanelItem(ctx.db, {
      panelId: panel.id,
      roleId: role.id,
      emoji,
      label: ctx.interaction.options.getString('rotulo') ?? role.name,
      description: ctx.interaction.options.getString('descricao'),
    });
    if (!item) {
      throw new UserFacingError(`${role} já está neste painel.`, { code: 'ITEM_EXISTS' });
    }

    await refreshIfPublished(ctx, await requirePanel(ctx, panel.id));
    await ctx.interaction.editReply({
      embeds: [
        successEmbed({
          title: 'Cargo adicionado',
          description: `${role} entrou no painel.`,
          fields: [
            { name: 'Rótulo', value: item.label, inline: true },
            { name: 'Emoji', value: emoji ? toEmojiIdentifier(emoji) : '—', inline: true },
          ],
          footer: botFooter(`${panel.items.length + 1}/${MAX_PANEL_ITEMS}`),
        }),
      ],
    });
  },
});
