import { ContextMenuCommandBuilder } from 'discord.js';

import type { AutomodService } from '../automod/engine';
import type { AutoroleService } from '../services/autorole';
import type { ConfigService, ResolvedSettings } from '../services/config';
import type { LockService } from '../services/locks';
import type { LogService } from '../services/logs';
import type { MessageCacheService } from '../services/message-cache';
import type { ModerationService } from '../services/moderation';
import type { ModlogService } from '../services/modlog';
import type { PollService } from '../services/polls';
import type { ReactionRoleService } from '../services/reaction-roles';
import type { StatsService } from '../services/stats';
import type { TicketService } from '../services/tickets';
import type { WelcomeService } from '../services/welcome';
import type { Db } from '@cobot/db';
import type { Module, PermissionLevel } from '@cobot/shared';
import type {
  Collection,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  GuildMember,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  UserContextMenuCommandInteraction,
} from 'discord.js';
import type { Logger } from 'pino';

/** Comandos indexados pelo nome registrado no Discord. */
export type CommandCollection = Collection<string, AnyCommand>;

/** Serviços compartilhados por comandos e eventos. */
export interface BotContext {
  client: Client;
  db: Db;
  config: ConfigService;
  moderation: ModerationService;
  /** Motor de automod (§5.2); nunca lança. */
  automod: AutomodService;
  /** Publicação de logs de evento (§5.4); nunca lança. */
  logs: LogService;
  modlog: ModlogService;
  /** Lock/unlock de canais com restauração exata dos overwrites (§5.3). */
  locks: LockService;
  /** Encerramento e resultado de enquetes (§5.3). */
  polls: PollService;
  /** Mensagens de entrada/saída (§5.5). */
  welcome: WelcomeService;
  /** Cargos automáticos e cargo de verificação (§5.5). */
  autorole: AutoroleService;
  /** Painéis de cargo por botão/select/reação (§5.5). */
  reactionRoles: ReactionRoleService;
  /** Abertura, gestão e fechamento de tickets (§5.5). */
  tickets: TicketService;
  messageCache: MessageCacheService;
  /** Agregador de estatísticas (§5.6); nunca lança. */
  stats: StatsService;
  logger: Logger;
  /** Coleção viva de comandos (usada pelo `/help` e pelo registro). */
  commands: CommandCollection;
}

/** Contexto de uma execução de comando, já com permissões resolvidas. */
export interface CommandContext<
  I extends ChatInputCommandInteraction | UserContextMenuCommandInteraction =
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
  SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;

/** Campos que slash commands e menus de contexto têm em comum. */
export interface CommandMeta {
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
}

export interface Command extends CommandMeta {
  data: CommandData;
  execute(ctx: CommandContext): Promise<void> | void;
  autocomplete?(ctx: AutocompleteContext): Promise<void> | void;
}

export type UserContextCommandContext = CommandContext<UserContextMenuCommandInteraction>;

/** Menu de contexto de usuário ("Punir…"): sem options, sem autocomplete. */
export interface UserContextCommand extends CommandMeta {
  data: ContextMenuCommandBuilder;
  execute(ctx: UserContextCommandContext): Promise<void> | void;
}

/** O que a `CommandCollection` guarda: os dois tipos convivem no registro. */
export type AnyCommand = Command | UserContextCommand;

/** Só dá nome ao objeto — existe para o tipo ser checado no arquivo do comando. */
export function defineCommand(command: Command): Command {
  return command;
}

export function defineUserContextCommand(command: UserContextCommand): UserContextCommand {
  return command;
}

/**
 * Discriminador dos dois tipos. A checagem é pela classe do builder porque é
 * a única marca que sobrevive ao `toJSON()` e ao bundle.
 */
export function isUserContextCommand(command: AnyCommand): command is UserContextCommand {
  return command.data instanceof ContextMenuCommandBuilder;
}

/** Nome do comando como aparece no Discord (`data.name`). */
export function commandName(command: AnyCommand): string {
  return command.data.name;
}
