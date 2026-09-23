import {
  AutomodConfigSchema,
  AutoroleConfigSchema,
  GeneralPageSchema,
  LogsPageSchema,
  ModerationConfigSchema,
  ReactionRolesConfigSchema,
  SocialConfigSchema,
  SquadsConfigSchema,
  TagsConfigSchema,
  TicketsConfigSchema,
  UtilitiesConfigSchema,
  WelcomeConfigSchema,
  type Module,
} from '@goodbot/shared';

import type { z } from 'zod';

/**
 * As três famílias de configuração. Existem porque onze telas numa lista só
 * não dizem onde procurar: a de índice (`/config`) desenha um bloco por
 * família e a sidebar segue a mesma ordem.
 */
export const CONFIG_GROUPS = [
  {
    id: 'bot',
    title: 'BOT',
    file: 'BOT.DIR',
    description: 'Identidade, idioma e quem pode rodar cada comando.',
  },
  {
    id: 'moderacao',
    title: 'MODERAÇÃO',
    file: 'MODERACAO.DIR',
    description: 'Punições, filtros automáticos e para onde vão os logs.',
  },
  {
    id: 'comunidade',
    title: 'COMUNIDADE',
    file: 'COMUNIDADE.DIR',
    description: 'O que o bot faz pelos membros: entrada, cargos, tickets, avisos.',
  },
] as const;

export type ConfigGroup = (typeof CONFIG_GROUPS)[number]['id'];

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
    group: 'bot',
    module: 'general',
    schema: GeneralPageSchema,
    title: 'GERAL',
    file: 'GERAL.CFG',
    description: 'Identidade do bot, cargos e o que ele responde por padrão.',
  },
  moderation: {
    group: 'moderacao',
    module: 'moderation',
    schema: ModerationConfigSchema,
    title: 'MODERAÇÃO',
    file: 'MODERACAO.CFG',
    description: 'Padrões das punições, DM ao punido e escalada de warns.',
  },
  automod: {
    group: 'moderacao',
    module: 'automod',
    schema: AutomodConfigSchema,
    title: 'AUTOMOD',
    file: 'AUTOMOD.CFG',
    description: 'Isenções globais, limites de execução e o modo raid.',
  },
  logs: {
    group: 'moderacao',
    module: 'logs',
    schema: LogsPageSchema,
    title: 'LOGS',
    file: 'LOGS.CFG',
    description: 'Para onde vai cada tipo de log e o que é ignorado.',
  },
  welcome: {
    group: 'comunidade',
    module: 'welcome',
    schema: WelcomeConfigSchema,
    title: 'BOAS-VINDAS',
    file: 'BOASVINDAS.CFG',
    description: 'Mensagens de entrada, saída e DM de boas-vindas.',
  },
  autorole: {
    group: 'comunidade',
    module: 'autorole',
    schema: AutoroleConfigSchema,
    title: 'AUTOROLE',
    file: 'AUTOROLE.CFG',
    description: 'Cargos dados na entrada e verificação por botão.',
  },
  tags: {
    group: 'comunidade',
    module: 'tags',
    schema: TagsConfigSchema,
    title: 'TAGS',
    file: 'TAGS.CFG',
    description: 'Quem cria tags, quem usa e os limites do módulo.',
  },
  'reaction-roles': {
    group: 'comunidade',
    module: 'reaction_roles',
    schema: ReactionRolesConfigSchema,
    title: 'REACTION ROLES',
    file: 'CARGOS.CFG',
    description: 'Painéis de cargo por botão, select ou reação.',
  },
  social: {
    group: 'comunidade',
    module: 'social',
    schema: SocialConfigSchema,
    title: 'REDES SOCIAIS',
    file: 'SOCIAL.CFG',
    description: 'Avisa no Discord quando as contas configuradas publicam.',
  },
  tickets: {
    group: 'comunidade',
    module: 'tickets',
    schema: TicketsConfigSchema,
    title: 'TICKETS',
    file: 'TICKETS.CFG',
    description: 'Tipos, painel de abertura, transcript e tickets abertos.',
  },
  squads: {
    group: 'comunidade',
    module: 'squads',
    schema: SquadsConfigSchema,
    title: 'BUSCAR SQUAD',
    file: 'SQUADS.CFG',
    description: 'Cargo de quem quer jogar agora, salas de voz que nascem e somem e o painel fixo.',
  },
  /**
   * As permissões de comando moram em `utilities.commandOverrides`, então a
   * página salva o módulo `utilities` inteiro — o resto do config viaja de
   * volta sem alteração em vez de ser sobrescrito por um objeto parcial.
   */
  commands: {
    group: 'bot',
    module: 'utilities',
    schema: UtilitiesConfigSchema,
    title: 'COMANDOS',
    file: 'COMANDOS.CFG',
    description: 'Ligar, desligar e restringir cada comando por cargo e canal.',
  },
} as const satisfies Record<
  string,
  {
    module: Module;
    schema: z.ZodType;
    group: ConfigGroup;
    title: string;
    file: string;
    description: string;
  }
>;

export type ConfigPage = keyof typeof CONFIG_PAGES;
export type ConfigPageValues<P extends ConfigPage = ConfigPage> = z.infer<
  (typeof CONFIG_PAGES)[P]['schema']
>;

export const CONFIG_PAGE_KEYS = Object.keys(CONFIG_PAGES) as ConfigPage[];

export function isConfigPage(value: unknown): value is ConfigPage {
  return typeof value === 'string' && Object.hasOwn(CONFIG_PAGES, value);
}
