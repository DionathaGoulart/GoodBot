import { getPanel } from '@cobot/db';
import { MessageFlags } from 'discord.js';

import {
  applyRoleChange,
  describeChange,
  hasChange,
  parsePanelCustomId,
  resolveClick,
  resolveSelect,
} from '../services/reaction-roles';

import type { BotContext } from '../lib/command';
import type { PanelWithItems } from '@cobot/db';
import type { GuildMember, MessageComponentInteraction } from 'discord.js';

/**
 * Botão e select de reaction role. A mensagem é persistente, então tudo o que
 * o handler precisa vem do `custom_id` e do banco — nada de estado em memória.
 */
export async function handleReactionRoleComponent(
  ctx: BotContext,
  interaction: MessageComponentInteraction,
): Promise<boolean> {
  const parsed = parsePanelCustomId(interaction.customId);
  if (!parsed) return false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guildId = interaction.guildId;
  const member = interaction.member as GuildMember | null;
  if (!guildId || !member || !('roles' in member)) {
    await interaction.editReply({ content: 'Não consegui ler seus cargos. Tente de novo.' });
    return true;
  }

  const config = await ctx.config.get(guildId, 'reaction_roles');
  if (!config.enabled) {
    await interaction.editReply({ content: 'Os cargos por reação estão desligados aqui.' });
    return true;
  }

  const panel = await getPanel(ctx.db, guildId, parsed.panelId);
  if (!panel || panel.items.length === 0) {
    await interaction.editReply({ content: 'Este painel não existe mais.' });
    return true;
  }

  const change = resolveChangeFor(panel, parsed.itemId, interaction, member);
  if (change === null) {
    await interaction.editReply({ content: 'Esta opção não faz mais parte do painel.' });
    return true;
  }

  if (!hasChange(change)) {
    await interaction.editReply({ content: 'Nada mudou nos seus cargos.' });
    return true;
  }

  try {
    await applyRoleChange(member, change);
  } catch (error) {
    // Cargo acima do bot, cargo apagado ou falta de `ManageRoles`.
    ctx.logger.warn(
      { err: error, guildId, panelId: panel.id, userId: member.id },
      'não foi possível aplicar o reaction role',
    );
    await interaction.editReply({
      content: 'Não consegui mexer nos seus cargos. Avise a moderação.',
    });
    return true;
  }

  await interaction.editReply({
    content: config.ephemeralFeedback ? describeChange(change) : 'Pronto.',
  });
  return true;
}

/** `null` = o item clicado saiu do painel desde que a mensagem foi publicada. */
function resolveChangeFor(
  panel: PanelWithItems,
  itemId: string | null,
  interaction: MessageComponentInteraction,
  member: GuildMember,
): ReturnType<typeof resolveClick> | null {
  const panelRoleIds = panel.items.map((item) => item.roleId);
  const currentRoleIds = [...member.roles.cache.keys()];

  if (itemId) {
    const item = panel.items.find((row) => row.id === itemId);
    if (!item) return null;
    return resolveClick({ mode: panel.mode, roleId: item.roleId, panelRoleIds, currentRoleIds });
  }

  if (!interaction.isStringSelectMenu()) return null;
  const selectedRoleIds = interaction.values
    .map((value) => panel.items.find((row) => row.id === value)?.roleId)
    .filter((id): id is string => Boolean(id));
  return resolveSelect({ mode: panel.mode, selectedRoleIds, panelRoleIds, currentRoleIds });
}
