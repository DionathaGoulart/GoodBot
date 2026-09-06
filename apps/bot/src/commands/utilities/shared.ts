import { UserFacingError } from '@cobot/shared';
import { ChannelType } from 'discord.js';

import { isLockable } from '../../services/locks';

import type { CommandContext } from '../../lib/command';
import type { LockableChannel } from '../../services/locks';
import type {
  ChatInputCommandInteraction,
  GuildTextBasedChannel,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandBuilder,
} from 'discord.js';

type OptionHost = SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandBuilder;

/** Tipos aceitos na opção `canal` de `/purge`, `/slowmode`, `/lock`. */
export const LOCKABLE_CHANNEL_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
] as const;

export function addChannelOption<B extends OptionHost>(
  builder: B,
  description = 'Canal alvo (padrão: este)',
): B {
  builder.addChannelOption((option) =>
    option
      .setName('canal')
      .setDescription(description)
      .addChannelTypes(...LOCKABLE_CHANNEL_TYPES),
  );
  return builder;
}

/** Canal da opção `canal`, ou o canal da interação. */
export function resolveChannel(interaction: ChatInputCommandInteraction): LockableChannel {
  const chosen = interaction.options.getChannel('canal');
  const channel = chosen
    ? interaction.guild?.channels.cache.get(chosen.id)
    : (interaction.channel as GuildTextBasedChannel | null);
  if (!isLockable(channel)) {
    throw new UserFacingError('Esse canal não aceita esta operação.', { code: 'BAD_CHANNEL' });
  }
  return channel;
}

/** Canal de texto onde dá para apagar mensagens (`/purge`). */
export function resolveTextChannel(
  interaction: ChatInputCommandInteraction,
): GuildTextBasedChannel {
  const chosen = interaction.options.getChannel('canal');
  const channel = chosen
    ? interaction.guild?.channels.cache.get(chosen.id)
    : (interaction.channel as GuildTextBasedChannel | null);
  if (!channel?.isTextBased() || channel.isDMBased()) {
    throw new UserFacingError('Esse canal não guarda mensagens que eu possa apagar.', {
      code: 'BAD_CHANNEL',
    });
  }
  return channel;
}

/** Config do módulo `utilities`, já validada e com defaults. */
export async function utilitiesConfig(ctx: CommandContext) {
  return ctx.config.get(ctx.guildId, 'utilities');
}

/**
 * O módulo precisa estar ligado. Comandos de utilidade não são de emergência,
 * então desligar o módulo desliga todos eles (PRD §5.7).
 */
export async function requireUtilities(ctx: CommandContext) {
  const config = await utilitiesConfig(ctx);
  if (!config.enabled) {
    throw new UserFacingError('O módulo de utilidades está desligado neste servidor.', {
      code: 'MODULE_DISABLED',
    });
  }
  return config;
}
