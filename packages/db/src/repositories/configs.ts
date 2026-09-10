import {
  DEFAULT_MODULE_CONFIGS,
  MODULE_SCHEMAS,
  type Module,
  type ModuleConfig,
  type ModuleConfigInput,
  parseModuleConfigOrDefault,
} from '@goodbot/shared';
import { and, eq, sql } from 'drizzle-orm';

import { guildSettings, moduleConfigs } from '../schema/configs';
import { guilds } from '../schema/guilds';

import type { DbExecutor } from '../client';
import type { GuildSettings } from '../types';

export interface ModuleConfigResult<M extends Module> {
  module: M;
  /** `enabled` da linha (também presente em `config.enabled`). */
  enabled: boolean;
  config: ModuleConfig<M>;
  /** `false` quando não há linha (default aplicado) ou o jsonb era inválido. */
  stored: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
}

type ModuleConfigRow = typeof moduleConfigs.$inferSelect;

function toResult<M extends Module>(
  module: M,
  row: ModuleConfigRow | undefined,
): ModuleConfigResult<M> {
  if (!row) {
    const config = DEFAULT_MODULE_CONFIGS[module];
    return {
      module,
      enabled: config.enabled,
      config,
      stored: false,
      updatedAt: null,
      updatedBy: null,
    };
  }
  const { config, valid } = parseModuleConfigOrDefault(module, {
    ...row.config,
    enabled: row.enabled,
  });
  return {
    module,
    enabled: config.enabled,
    config,
    stored: valid,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

/**
 * Lê o config de um módulo, valida com o Zod de `@goodbot/shared` e aplica os
 * defaults. Nunca lança por jsonb inválido: volta ao default e marca
 * `stored: false` para o chamador logar.
 */
export async function getModuleConfig<M extends Module>(
  db: DbExecutor,
  guildId: string,
  module: M,
): Promise<ModuleConfigResult<M>> {
  const [row] = await db
    .select()
    .from(moduleConfigs)
    .where(and(eq(moduleConfigs.guildId, guildId), eq(moduleConfigs.module, module)))
    .limit(1);
  return toResult(module, row);
}

export type AllModuleConfigs = { [M in Module]: ModuleConfigResult<M> };

/** Lê todos os módulos de uma guild em uma query (para aquecer o cache). */
export async function getAllModuleConfigs(
  db: DbExecutor,
  guildId: string,
): Promise<AllModuleConfigs> {
  const rows = await db.select().from(moduleConfigs).where(eq(moduleConfigs.guildId, guildId));
  const byModule = new Map(rows.map((r) => [r.module, r] as const));
  const entries = (Object.keys(MODULE_SCHEMAS) as Module[]).map(
    (module) => [module, toResult(module, byModule.get(module))] as const,
  );
  return Object.fromEntries(entries) as AllModuleConfigs;
}

/**
 * Valida e grava (upsert) o config de um módulo. Lança `ZodError` se o input
 * for inválido — o chamador (painel/comando) converte em erro para o usuário.
 * Garante a linha em `guilds` (FK) sem sobrescrever nome/owner existentes.
 */
export async function setModuleConfig<M extends Module>(
  db: DbExecutor,
  guildId: string,
  module: M,
  input: ModuleConfigInput<M>,
  updatedBy: string | null = null,
): Promise<ModuleConfig<M>> {
  const config = MODULE_SCHEMAS[module].parse(input) as ModuleConfig<M>;

  await db
    .insert(guilds)
    .values({ id: guildId, name: '', ownerId: '' })
    .onConflictDoNothing({ target: guilds.id });

  await db
    .insert(moduleConfigs)
    .values({
      guildId,
      module,
      enabled: config.enabled,
      config: config as Record<string, unknown>,
      version: config.version,
      updatedBy,
    })
    .onConflictDoUpdate({
      target: [moduleConfigs.guildId, moduleConfigs.module],
      set: {
        enabled: config.enabled,
        config: config as Record<string, unknown>,
        version: config.version,
        updatedBy,
        updatedAt: sql`now()`,
      },
    });

  return config;
}

/** Liga/desliga um módulo preservando o resto do config. */
export async function setModuleEnabled(
  db: DbExecutor,
  guildId: string,
  module: Module,
  enabled: boolean,
  updatedBy: string | null = null,
): Promise<void> {
  const current = await getModuleConfig(db, guildId, module);
  await setModuleConfig(
    db,
    guildId,
    module,
    { ...current.config, enabled } as ModuleConfigInput<typeof module>,
    updatedBy,
  );
}

/**
 * Preferências gerais da guild (PRD §8). O painel precisa do `timezone` para
 * saber onde o dia começa nos gráficos; `null` = guild sem linha ainda.
 */
export async function getGuildSettings(
  db: DbExecutor,
  guildId: string,
): Promise<GuildSettings | null> {
  const [row] = await db
    .select()
    .from(guildSettings)
    .where(eq(guildSettings.guildId, guildId))
    .limit(1);
  return row ?? null;
}

export type GuildSettingsInput = Pick<
  GuildSettings,
  | 'timezone'
  | 'embedColor'
  | 'modRoleIds'
  | 'adminRoleIds'
  | 'dashboardAccessRoleIds'
  | 'logChannelId'
  | 'dmOnPunish'
>;

/**
 * Upsert das preferências gerais. Como em `setModuleConfig`, garante a linha
 * em `guilds` (FK) sem sobrescrever nome/owner que o bot já tenha gravado.
 */
export async function setGuildSettings(
  db: DbExecutor,
  guildId: string,
  input: GuildSettingsInput,
): Promise<void> {
  await db
    .insert(guilds)
    .values({ id: guildId, name: '', ownerId: '' })
    .onConflictDoNothing({ target: guilds.id });

  await db
    .insert(guildSettings)
    .values({ guildId, ...input })
    .onConflictDoUpdate({
      target: guildSettings.guildId,
      set: { ...input, updatedAt: sql`now()` },
    });
}
