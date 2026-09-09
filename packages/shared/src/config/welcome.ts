import { z } from 'zod';

import { MessageTemplateSchema } from '../templates';
import { moduleConfigBase, NullableSnowflakeSchema } from './common';

const WelcomeChannelMessageSchema = z.object({
  enabled: z.boolean().default(false),
  channelId: NullableSnowflakeSchema,
  template: MessageTemplateSchema.nullable().default(null),
  /** Apagar a mensagem após N segundos; 0 = manter. */
  deleteAfterSeconds: z.number().int().min(0).max(86_400).default(0),
});

/**
 * Agradecimento a quem impulsiona o servidor, mais o cargo que marca a pessoa
 * enquanto o impulso durar. Fica no módulo de boas-vindas porque é a mesma
 * mecânica: um evento de membro vira uma mensagem num canal.
 */
const BoostMessageSchema = z.object({
  enabled: z.boolean().default(false),
  channelId: NullableSnowflakeSchema,
  template: MessageTemplateSchema.nullable().default(null),
  /**
   * Cargo dado a quem impulsiona e tirado quando o impulso acaba. O Discord já
   * tem o cargo nativo "Nitro Booster", mas ele não pode ser posicionado nem
   * colorido pelo servidor — este pode.
   */
  roleId: NullableSnowflakeSchema,
});

export const WelcomeConfigSchema = z.object({
  ...moduleConfigBase,
  join: WelcomeChannelMessageSchema.default(WelcomeChannelMessageSchema.parse({})),
  leave: WelcomeChannelMessageSchema.default(WelcomeChannelMessageSchema.parse({})),
  boost: BoostMessageSchema.default(BoostMessageSchema.parse({})),
  dm: z
    .object({
      enabled: z.boolean().default(false),
      template: MessageTemplateSchema.nullable().default(null),
    })
    .default({ enabled: false, template: null }),
  /** Ignorar bots nas mensagens de entrada/saída. */
  ignoreBots: z.boolean().default(true),
});
export type WelcomeConfig = z.infer<typeof WelcomeConfigSchema>;
export const DEFAULT_WELCOME_CONFIG: WelcomeConfig = WelcomeConfigSchema.parse({});
