import type { ConfigService, ResolvedSettings } from '../services/config';
import type { Db } from '@cobot/db';
import type { Module, PermissionLevel } from '@cobot/shared';
import type { Collection ,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  ContextMenuCommandBuilder,
  ContextMenuCommandInteraction,
  GuildMember,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import type { Logger } from 'pino';

/** Comandos indexados pelo nome registrado no Discord. */
export type CommandCollection = Collection<string, Command>;

/** Serviços compartilhados por comandos e eventos. */
export interface BotContext {
  client: Client;
  db: Db;
  config: ConfigService;
  logger: Logger;
  /** Coleção viva de comandos (usada pelo `/help` e pelo registro). */
  commands: CommandCollection;
}

/** Contexto de uma execução de comando, já com permissões resolvidas. */
export interface CommandContext<
  I extends ChatInputCommandInteraction | ContextMenuCommandInteraction =
    ChatInputCommandInteraction,
> extends BotContext {
  interaction: I;
  guildId: string;
  /** Sempre presente: comandos só rodam em guild (ver `interaction.ts`). */
  member: GuildMember;
  /** Nível efetivo de quem executou. */
  level: PermissionLevel;
  settings: ResolvedSettings;
}

export interface AutocompleteContext extends BotContext {
  interaction: AutocompleteInteraction;
  guildId: string;
  settings: ResolvedSettings;
}

/** Builders aceitos por um slash command (com ou sem options/subcommands). */
export type CommandData =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder
  | SlashCommandSubcommandsOnlyBuilder
  | ContextMenuCommandBuilder;

export interface Command {
  data: CommandData;
  /** Módulo dono do comando: agrupa o `/help` e liga/desliga junto do módulo. */
  module: Module;
  /** Nível mínimo exigido (PRD §9.1). O handler re-verifica sempre. */
  level: PermissionLevel;
  /** Segundos entre execuções por usuário. `0`/ausente = sem cooldown. */
  cooldown?: number;
  /** `deferReply` automático antes de `execute` (comandos que passam de 3s). */
  defer?: boolean;
  /** Usado com `defer`: a resposta adiada nasce efêmera. */
  ephemeral?: boolean;
  /** Descrição curta para o `/help` (default: a do builder). */
  help?: string;
  execute(ctx: CommandContext): Promise<void> | void;
  autocomplete?(ctx: AutocompleteContext): Promise<void> | void;
}

/** Só dá nome ao objeto — existe para o tipo ser checado no arquivo do comando. */
export function defineCommand(command: Command): Command {
  return command;
}

/** Nome do comando como aparece no Discord (`data.name`). */
export function commandName(command: Command): string {
  return command.data.name;
}
