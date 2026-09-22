import { z } from 'zod';

import { EmbedColorSchema } from '../templates';
import { NullableSnowflakeSchema, SnowflakeListSchema } from './common';
import { GeneralConfigSchema } from './general';
import { DmOnPunishSchema } from './moderation';

/** Fuso aceito pelo `Intl` do Node — o painel usa para saber onde o dia começa. */
export function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const TimezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimezone, { message: 'Fuso horário desconhecido' });

/**
 * Colunas de `guild_settings` (PRD §8) como formulário. Não é um módulo: mora
 * numa tabela própria porque o bot lê estes campos em todo comando.
 */
export const GuildSettingsSchema = z.object({
  timezone: TimezoneSchema.default('America/Sao_Paulo'),
  embedColor: EmbedColorSchema.default(0xdc143c),
  modRoleIds: SnowflakeListSchema,
  adminRoleIds: SnowflakeListSchema,
  dashboardAccessRoleIds: SnowflakeListSchema,
  logChannelId: NullableSnowflakeSchema,
  /**
   * Onde o bot avisa sobre si mesmo (manutenção, broadcast, fim da demo).
   * `null` = canal de sistema do Discord, o mesmo destino de antes do campo.
   */
  noticeChannelId: NullableSnowflakeSchema,
  /** `null` = herdar o `dmOnPunish` do módulo de moderação. */
  dmOnPunish: DmOnPunishSchema.nullable().default(null),
});
export type GuildSettingsConfig = z.infer<typeof GuildSettingsSchema>;
export const DEFAULT_GUILD_SETTINGS: GuildSettingsConfig = GuildSettingsSchema.parse({});

/**
 * A página "Geral" do painel salva duas coisas de uma vez: as colunas de
 * `guild_settings` e o módulo `general`. Um schema só para um `SALVAR` só.
 */
export const GeneralPageSchema = z.object({
  settings: GuildSettingsSchema,
  module: GeneralConfigSchema,
});
export type GeneralPageValues = z.infer<typeof GeneralPageSchema>;
