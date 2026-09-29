import type { BotContext } from '../lib/command';
import type { DeployNoticeService } from '../services/deploy-notice';
import type { Guild } from 'discord.js';

/** O que a API precisa do bot: os mesmos serviços que os comandos usam. */
export type ApiDeps = Pick<
  BotContext,
  | 'client'
  | 'db'
  | 'config'
  | 'moderation'
  | 'automod'
  | 'reactionRoles'
  | 'tickets'
  | 'social'
  | 'commands'
  // As duas últimas só são usadas pelas rotas `/admin`: quem o bot atende e
  // se ele está em manutenção não são assunto de guild.
  | 'registry'
  | 'maintenance'
> & {
  /** Só da rota `/admin/deploy-notice`: nenhum comando avisa deploy. */
  deployNotice: Pick<DeployNoticeService, 'announce'>;
};

/** Variáveis que os middlewares põem no contexto do Hono. */
export interface ApiVariables {
  requestId: string;
  /** Preenchido pelo middleware de guild em tudo sob `/guilds/:guildId`. */
  guild: Guild;
}

export interface ApiEnv {
  Variables: ApiVariables;
}
