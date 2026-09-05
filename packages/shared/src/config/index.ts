import { AutomodConfigSchema, DEFAULT_AUTOMOD_CONFIG } from './automod';
import { AutoroleConfigSchema, DEFAULT_AUTOROLE_CONFIG } from './autorole';
import { DEFAULT_GENERAL_CONFIG, GeneralConfigSchema } from './general';
import { DEFAULT_LOGS_CONFIG, LogsConfigSchema } from './logs';
import { DEFAULT_MODERATION_CONFIG, ModerationConfigSchema } from './moderation';
import { DEFAULT_REACTION_ROLES_CONFIG, ReactionRolesConfigSchema } from './reaction-roles';
import { DEFAULT_STATS_CONFIG, StatsConfigSchema } from './stats';
import { DEFAULT_TAGS_CONFIG, TagsConfigSchema } from './tags';
import { DEFAULT_TICKETS_CONFIG, TicketsConfigSchema } from './tickets';
import { DEFAULT_UTILITIES_CONFIG, UtilitiesConfigSchema } from './utilities';
import { DEFAULT_WELCOME_CONFIG, WelcomeConfigSchema } from './welcome';

import type { Module } from '../constants';
import type { z } from 'zod';

export * from './common';
export * from './general';
export * from './moderation';
export * from './automod';
export * from './automod-rule';
export * from './logs';
export * from './welcome';
export * from './autorole';
export * from './reaction-roles';
export * from './tickets';
export * from './tags';
export * from './utilities';
export * from './stats';

/** Módulo → schema Zod do jsonb `module_configs.config`. */
export const MODULE_SCHEMAS = {
  general: GeneralConfigSchema,
  moderation: ModerationConfigSchema,
  automod: AutomodConfigSchema,
  logs: LogsConfigSchema,
  welcome: WelcomeConfigSchema,
  autorole: AutoroleConfigSchema,
  reaction_roles: ReactionRolesConfigSchema,
  tickets: TicketsConfigSchema,
  tags: TagsConfigSchema,
  utilities: UtilitiesConfigSchema,
  stats: StatsConfigSchema,
} as const satisfies Record<Module, z.ZodType>;

export type ModuleSchemas = typeof MODULE_SCHEMAS;
/** Tipo do config já validado de um módulo. */
export type ModuleConfig<M extends Module = Module> = z.infer<ModuleSchemas[M]>;
/** Tipo aceito na entrada (campos opcionais antes dos defaults). */
export type ModuleConfigInput<M extends Module = Module> = z.input<ModuleSchemas[M]>;

/** Módulo → config padrão (equivalente a `MODULE_SCHEMAS[m].parse({})`). */
export const DEFAULT_MODULE_CONFIGS: { readonly [M in Module]: ModuleConfig<M> } = {
  general: DEFAULT_GENERAL_CONFIG,
  moderation: DEFAULT_MODERATION_CONFIG,
  automod: DEFAULT_AUTOMOD_CONFIG,
  logs: DEFAULT_LOGS_CONFIG,
  welcome: DEFAULT_WELCOME_CONFIG,
  autorole: DEFAULT_AUTOROLE_CONFIG,
  reaction_roles: DEFAULT_REACTION_ROLES_CONFIG,
  tickets: DEFAULT_TICKETS_CONFIG,
  tags: DEFAULT_TAGS_CONFIG,
  utilities: DEFAULT_UTILITIES_CONFIG,
  stats: DEFAULT_STATS_CONFIG,
};

/** Valida (e completa com defaults) o config de um módulo. Lança `ZodError`. */
export function parseModuleConfig<M extends Module>(module: M, raw: unknown): ModuleConfig<M> {
  return MODULE_SCHEMAS[module].parse(raw) as ModuleConfig<M>;
}

/**
 * Como `parseModuleConfig`, mas nunca lança: config inválido (ex.: formato
 * antigo) volta ao default, para o bot não parar por um jsonb corrompido.
 */
export function parseModuleConfigOrDefault<M extends Module>(
  module: M,
  raw: unknown,
): { config: ModuleConfig<M>; valid: boolean } {
  const result = MODULE_SCHEMAS[module].safeParse(raw ?? {});
  if (result.success) return { config: result.data as ModuleConfig<M>, valid: true };
  return { config: DEFAULT_MODULE_CONFIGS[module], valid: false };
}
