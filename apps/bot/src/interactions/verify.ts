import { MessageFlags } from 'discord.js';

import { VERIFY_REASON } from '../services/autorole';

import type { BotContext } from '../lib/command';
import type { ButtonInteraction, GuildMember } from 'discord.js';

/** `custom_id` do botão publicado por `/verify setup`. */
export const VERIFY_BUTTON_ID = 'verify';

/**
 * Botão de verificação: dá o cargo configurado e responde sempre efêmero.
 * A mensagem é persistente (fica no canal para sempre), então o handler não
 * pode depender de nada em memória — a config vem do `ConfigService`.
 */
export async function handleVerifyButton(
  ctx: BotContext,
  interaction: ButtonInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guildId = interaction.guildId;
  const member = interaction.member as GuildMember | null;
  if (!guildId || !member || !('roles' in member)) {
    await interaction.editReply({ content: 'Não consegui ler seus cargos. Tente de novo.' });
    return;
  }

  const config = await ctx.config.get(guildId, 'autorole');
  if (!config.enabled || !config.verify.enabled || !config.verify.roleId) {
    await interaction.editReply({ content: 'A verificação está desligada neste servidor.' });
    return;
  }

  const roleId = config.verify.roleId;
  if (member.roles.cache.has(roleId)) {
    await interaction.editReply({ content: `Você já tem o cargo <@&${roleId}>.` });
    return;
  }

  try {
    await member.roles.add(roleId, VERIFY_REASON);
  } catch (error) {
    ctx.logger.warn(
      { err: error, guildId, userId: member.id, roleId },
      'não foi possível dar o cargo de verificação',
    );
    await interaction.editReply({
      content: 'Não consegui te dar o cargo. Avise a moderação.',
    });
    return;
  }

  await interaction.editReply({ content: `Verificado! Você recebeu <@&${roleId}>.` });
}
