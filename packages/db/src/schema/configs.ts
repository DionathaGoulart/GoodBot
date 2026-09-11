import { boolean, index, integer, jsonb, pgTable, primaryKey } from 'drizzle-orm/pg-core';

import { createdAt, snowflake, snowflakeArray, text, updatedAt } from './_columns';
import { logKindEnum, moduleEnum } from './enums';
import { guilds } from './guilds';

import type { DmOnPunish } from '@goodbot/shared';

/** Preferências gerais da guild (PRD §8). */
export const guildSettings = pgTable('guild_settings', {
  guildId: snowflake('guild_id')
    .primaryKey()
    .references(() => guilds.id, { onDelete: 'cascade' }),
  timezone: text('timezone').notNull().default('America/Sao_Paulo'),
  /** Inteiro RGB (0x000000–0xFFFFFF). */
  embedColor: integer('embed_color').notNull().default(0xdc143c),
  modRoleIds: snowflakeArray('mod_role_ids'),
  adminRoleIds: snowflakeArray('admin_role_ids'),
  dashboardAccessRoleIds: snowflakeArray('dashboard_access_role_ids'),
  /** Canal de logs geral; tipos sem canal próprio herdam dele. */
  logChannelId: snowflake('log_channel_id'),
  dmOnPunish: jsonb('dm_on_punish').$type<DmOnPunish>(),
  /**
   * Espelho da bio do bot **nesta** guild (PRD §6.6). O Discord aceita
   * escrever a bio do membro mas não a devolve em lugar nenhum, então sem esta
   * coluna o painel não teria como mostrar a que está valendo. Quem escreve é
   * só a rota `bot-profile`, e só depois de o Discord aceitar.
   */
  botBio: text('bot_bio'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Config jsonb por módulo, validado pelo Zod de `@goodbot/shared`. */
export const moduleConfigs = pgTable(
  'module_configs',
  {
    guildId: snowflake('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    module: moduleEnum('module').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    /** Versão do formato do jsonb (espelha `config.version`). */
    version: integer('version').notNull().default(1),
    updatedAt: updatedAt(),
    updatedBy: snowflake('updated_by'),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.module] })],
);

/** Canal e toggle por tipo de log (PRD §5.4). */
export const logConfigs = pgTable(
  'log_configs',
  {
    guildId: snowflake('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    kind: logKindEnum('kind').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    /** `null` = herdar `guild_settings.log_channel_id`. */
    channelId: snowflake('channel_id'),
    ignoredChannelIds: snowflakeArray('ignored_channel_ids'),
    ignoredRoleIds: snowflakeArray('ignored_role_ids'),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.guildId, t.kind] }),
    index('log_configs_guild_idx').on(t.guildId),
  ],
);
