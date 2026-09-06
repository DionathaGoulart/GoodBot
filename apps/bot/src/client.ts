import {
  ChannelType,
  Client,
  GatewayIntentBits,
  Options,
  Partials,
  type ClientOptions,
} from 'discord.js';

/**
 * Intents do PRD §10. `GuildPresences` fica de fora de propósito: nenhum
 * módulo depende de presença e ela é a intent mais cara em memória.
 */
export const INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.GuildExpressions,
] as const;

/**
 * Partials são obrigatórios para reagir a mensagens/reações antigas que não
 * estão no cache (reaction roles, logs de mensagem apagada).
 */
export const PARTIALS = [
  Partials.Message,
  Partials.Channel,
  Partials.Reaction,
  Partials.GuildMember,
  Partials.User,
] as const;

/**
 * Limites de cache pensados para a ARM free tier (PRD §7.2): guardamos o que
 * os módulos realmente consultam (membros, cargos, canais) e cortamos o resto.
 */
export const clientOptions: ClientOptions = {
  intents: [...INTENTS],
  partials: [...PARTIALS],
  allowedMentions: { parse: [], repliedUser: false },
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 200,
    PresenceManager: 0,
    GuildInviteManager: 0,
    GuildScheduledEventManager: 0,
    GuildStickerManager: 0,
    ThreadManager: 100,
    ReactionUserManager: 0,
    VoiceStateManager: 100,
  }),
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: { interval: 600, lifetime: 3600 },
    threads: { interval: 3600, lifetime: 14_400 },
  },
};

export function createClient(): Client {
  return new Client(clientOptions);
}

/** Canais em que o bot pode responder/postar embeds. */
export const TEXT_CHANNEL_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
] as const;
