import {
  AutoroleConfigSchema,
  GeneralPageSchema,
  LogsPageSchema,
  ModerationConfigSchema,
  TagsConfigSchema,
  WelcomeConfigSchema,
  type Module,
} from '@cobot/shared';

import type { z } from 'zod';

/**
 * As telas de configuração do painel. Isomórfico de propósito: o formulário no
 * browser e a server action validam com **o mesmo** schema, então nada entra
 * no banco por um caminho que o cliente não conhece (CLAUDE.md, §Validação).
 *
 * Quase toda página é um módulo puro (`module_configs`). As exceções guardam
 * parte do estado em outra tabela e por isso têm schema próprio:
 * `general` (+ `guild_settings`) e `logs` (+ `log_configs`).
 */
export const CONFIG_PAGES = {
  general: {
    module: 'general',
    schema: GeneralPageSchema,
    title: 'GERAL',
    file: 'GERAL.CFG',
    description: 'Identidade do bot, cargos e o que ele responde por padrão.',
  },
  moderation: {
    module: 'moderation',
    schema: ModerationConfigSchema,
    title: 'MODERAÇÃO',
    file: 'MODERACAO.CFG',
    description: 'Padrões das punições, DM ao punido e escalada de warns.',
  },
  logs: {
    module: 'logs',
    schema: LogsPageSchema,
    title: 'LOGS',
    file: 'LOGS.CFG',
    description: 'Para onde vai cada tipo de log e o que é ignorado.',
  },
  welcome: {
    module: 'welcome',
    schema: WelcomeConfigSchema,
    title: 'BOAS-VINDAS',
    file: 'BOASVINDAS.CFG',
    description: 'Mensagens de entrada, saída e DM de boas-vindas.',
  },
  autorole: {
    module: 'autorole',
    schema: AutoroleConfigSchema,
    title: 'AUTOROLE',
    file: 'AUTOROLE.CFG',
    description: 'Cargos dados na entrada e verificação por botão.',
  },
  tags: {
    module: 'tags',
    schema: TagsConfigSchema,
    title: 'TAGS',
    file: 'TAGS.CFG',
    description: 'Quem cria tags, quem usa e os limites do módulo.',
  },
} as const satisfies Record<
  string,
  { module: Module; schema: z.ZodType; title: string; file: string; description: string }
>;

export type ConfigPage = keyof typeof CONFIG_PAGES;
export type ConfigPageValues<P extends ConfigPage = ConfigPage> = z.infer<
  (typeof CONFIG_PAGES)[P]['schema']
>;

export const CONFIG_PAGE_KEYS = Object.keys(CONFIG_PAGES) as ConfigPage[];

export function isConfigPage(value: unknown): value is ConfigPage {
  return typeof value === 'string' && Object.hasOwn(CONFIG_PAGES, value);
}
