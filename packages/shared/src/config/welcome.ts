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

export const WelcomeConfigSchema = z.object({
  ...moduleConfigBase,
  join: WelcomeChannelMessageSchema.default(WelcomeChannelMessageSchema.parse({})),
  leave: WelcomeChannelMessageSchema.default(WelcomeChannelMessageSchema.parse({})),
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
