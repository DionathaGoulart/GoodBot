import { isUserFacingError, UserFacingError } from '@cobot/shared';
import { MessageFlags } from 'discord.js';

import { env } from '../env';
import { childLogger } from '../logger';
import { CooldownStore } from './cooldown';
import { botFooter, errorEmbed } from './embeds';
import { levelAtLeast, resolveLevel, toMemberLike } from '../services/permissions';

import type { AutocompleteContext, BotContext, Command, CommandContext } from './command';
import type { PermissionLevel } from '@cobot/shared';
import type {
  ChatInputCommandInteraction,
  GuildMember,
  Interaction,
  RepliableInteraction,
} from 'discord.js';

export { CooldownStore };

const log = childLogger('interaction');

const LEVEL_LABEL: Record<PermissionLevel, string> = {
  member: 'membro',
  mod: 'moderação',
  admin: 'administração',
};

/** Responde efêmero sem estourar caso a interação já tenha sido respondida. */
async function replyError(interaction: RepliableInteraction, message: string): Promise<void> {
  const embed = errorEmbed({ title: 'Erro', description: message, footer: botFooter() });
  try {
    if (interaction.deferred) {
      await interaction.editReply({ embeds: [embed] });
    } else if (interaction.replied) {
      await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    log.warn({ err: error }, 'não foi possível responder o erro ao usuário');
  }
}

export interface HandlerOptions {
  cooldowns?: CooldownStore;
}

/**
 * Handler de `interactionCreate`: filtra a guild, resolve permissões, aplica
 * cooldown e garante que **toda** interação recebe uma resposta — erro de
 * usuário vira embed efêmero, o resto é logado e vira mensagem genérica.
 */
export function createInteractionHandler(options: HandlerOptions = {}) {
  const cooldowns = options.cooldowns ?? new CooldownStore();

  return async function handleInteraction(
    ctx: BotContext,
    interaction: Interaction,
  ): Promise<void> {
    // Single-server hoje: um único ponto ignora eventos de outras guilds.
    if (!interaction.inGuild() || interaction.guildId !== env.GUILD_ID) return;

    if (interaction.isAutocomplete()) {
      const command = ctx.commands.get(interaction.commandName);
      if (!command?.autocomplete) return;
      try {
        const settings = await ctx.config.getSettings(interaction.guildId);
        const autocompleteCtx: AutocompleteContext = {
          ...ctx,
          interaction,
          guildId: interaction.guildId,
          settings,
        };
        await command.autocomplete(autocompleteCtx);
      } catch (error) {
        log.error({ err: error, command: interaction.commandName }, 'erro no autocomplete');
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = ctx.commands.get(interaction.commandName);
    if (!command) {
      await replyError(interaction, 'Comando desconhecido. Ele pode ter sido removido.');
      return;
    }

    try {
      await runCommand(ctx, interaction, command, cooldowns);
    } catch (error) {
      if (isUserFacingError(error)) {
        log.debug(
          { code: error.code, command: command.data.name, userId: interaction.user.id },
          'erro de usuário',
        );
        await replyError(interaction, error.message);
        return;
      }
      log.error(
        { err: error, command: command.data.name, userId: interaction.user.id },
        'erro ao executar comando',
      );
      await replyError(
        interaction,
        'Algo deu errado ao executar este comando. A equipe já foi avisada.',
      );
    }
  };
}

async function runCommand(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
  command: Command,
  cooldowns: CooldownStore,
): Promise<void> {
  const guildId = interaction.guildId as string;
  const member = interaction.member as GuildMember | null;
  if (!member || !('roles' in member)) {
    throw new UserFacingError('Não consegui ler seus cargos. Tente novamente.', {
      code: 'NO_MEMBER',
    });
  }

  const settings = await ctx.config.getSettings(guildId);
  const level = resolveLevel(toMemberLike(member), settings);

  // O `default_member_permissions` do registro é dica de UI; a checagem real é
  // aqui (PRD §9.1).
  if (!levelAtLeast(level, command.level)) {
    throw new UserFacingError(`Este comando é restrito a ${LEVEL_LABEL[command.level]}.`, {
      code: 'FORBIDDEN',
    });
  }

  const remaining = cooldowns.hit(interaction.user.id, command.data.name, command.cooldown ?? 0);
  if (remaining > 0) {
    throw new UserFacingError(
      `Aguarde ${remaining}s antes de usar /${command.data.name} de novo.`,
      {
        code: 'COOLDOWN',
      },
    );
  }

  if (command.defer) {
    await interaction.deferReply(command.ephemeral ? { flags: MessageFlags.Ephemeral } : {});
  }

  const commandCtx: CommandContext = {
    ...ctx,
    interaction,
    guildId,
    member,
    level,
    settings,
  };
  await command.execute(commandCtx);

  // Um comando que não responde deixa o usuário com "falha na interação".
  if (!interaction.replied && !interaction.deferred) {
    log.warn({ command: command.data.name }, 'comando terminou sem responder à interação');
  }
}
