import { DEFAULT_COMMAND_OVERRIDE, isUserFacingError, UserFacingError } from '@cobot/shared';
import { MessageFlags } from 'discord.js';

import { env } from '../env';
import { childLogger } from '../logger';
import { isUserContextCommand } from './command';
import { assertCommandAllowed } from './command-overrides';
import { CooldownStore } from './cooldown';
import { botFooter, errorEmbed } from './embeds';
import { handleComponent, handleModal } from '../interactions/index';
import { levelAtLeast, resolveLevel, toMemberLike } from '../services/permissions';

import type { AnyCommand, AutocompleteContext, BotContext, CommandContext } from './command';
import type { PermissionLevel } from '@cobot/shared';
import type {
  ChatInputCommandInteraction,
  GuildMember,
  Interaction,
  RepliableInteraction,
  UserContextMenuCommandInteraction,
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

/**
 * Botões, selects e modais compartilham o mesmo contrato: `false` = ninguém
 * reconheceu o `custom_id`, e toda falha vira resposta efêmera — a interação
 * nunca pode ficar sem resposta.
 */
async function runComponent(
  interaction: RepliableInteraction & { customId: string },
  run: () => Promise<boolean>,
): Promise<void> {
  try {
    const handled = await run();
    // Componente de uma mensagem antiga: o usuário não pode ficar com
    // "falha na interação" na tela.
    if (!handled) {
      await replyError(interaction, 'Este botão não vale mais. Peça uma mensagem nova.');
    }
  } catch (error) {
    if (isUserFacingError(error)) {
      await replyError(interaction, error.message);
      return;
    }
    log.error({ err: error, customId: interaction.customId }, 'erro no componente');
    await replyError(interaction, 'Não consegui registrar essa ação. Tente de novo.');
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
      // Menu de contexto não tem options, logo nunca gera autocomplete.
      if (!command || isUserContextCommand(command) || !command.autocomplete) return;
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

    if (interaction.isMessageComponent()) {
      await runComponent(interaction, () => handleComponent(ctx, interaction));
      return;
    }

    if (interaction.isModalSubmit()) {
      await runComponent(interaction, () => handleModal(ctx, interaction));
      return;
    }

    if (!interaction.isChatInputCommand() && !interaction.isUserContextMenuCommand()) return;

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
  interaction: ChatInputCommandInteraction | UserContextMenuCommandInteraction,
  command: AnyCommand,
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

  // Só quem já passou no nível chega aqui, então o override nunca alarga o
  // acesso — no máximo tira quem o comando deixaria entrar.
  const { commandOverrides } = await ctx.config.get(guildId, 'utilities');
  const override = commandOverrides[command.data.name];
  if (override) {
    assertCommandAllowed(
      { ...DEFAULT_COMMAND_OVERRIDE, ...override },
      { channelId: interaction.channelId, roleIds: [...member.roles.cache.keys()] },
    );
  }

  const remaining = cooldowns.hit(interaction.user.id, command.data.name, command.cooldown ?? 0);
  if (remaining > 0) {
    throw new UserFacingError(`Aguarde ${remaining}s antes de usar ${command.data.name} de novo.`, {
      code: 'COOLDOWN',
    });
  }

  // Um menu de contexto que abre modal não pode ser adiado antes (o `showModal`
  // exige a interação intacta), então `defer` é decisão do próprio comando.
  if (command.defer) {
    await interaction.deferReply(command.ephemeral ? { flags: MessageFlags.Ephemeral } : {});
  }

  const base = { ...ctx, guildId, member, level, settings };

  if (isUserContextCommand(command)) {
    if (!interaction.isUserContextMenuCommand()) {
      throw new UserFacingError('Este comando só funciona pelo menu de contexto.', {
        code: 'WRONG_INTERACTION',
      });
    }
    await command.execute({ ...base, interaction });
  } else {
    if (!interaction.isChatInputCommand()) {
      throw new UserFacingError('Este comando só funciona como slash command.', {
        code: 'WRONG_INTERACTION',
      });
    }
    const commandCtx: CommandContext = { ...base, interaction };
    await command.execute(commandCtx);
  }

  // Só comandos que chegaram ao fim contam: erro e cooldown não são uso.
  void ctx.stats.recordCommand(guildId, command.data.name);

  // Um comando que não responde deixa o usuário com "falha na interação".
  if (!interaction.replied && !interaction.deferred) {
    log.warn({ command: command.data.name }, 'comando terminou sem responder à interação');
  }
}
