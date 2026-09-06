import type { BotContext } from '../lib/command';
import type { Guild } from 'discord.js';

/** O que a API precisa do bot: os mesmos serviços que os comandos usam. */
export type ApiDeps = Pick<
  BotContext,
  'client' | 'db' | 'config' | 'moderation' | 'reactionRoles' | 'tickets'
>;

/** Variáveis que os middlewares põem no contexto do Hono. */
export interface ApiVariables {
  requestId: string;
  /** Preenchido pelo middleware de guild em tudo sob `/guilds/:guildId`. */
  guild: Guild;
}

export interface ApiEnv {
  Variables: ApiVariables;
}
