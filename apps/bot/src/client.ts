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
 * Teto do cache de membros **por guild**.
 *
 * Cada guild tem o seu `GuildMemberManager`, então a conta de RAM é
 * `guilds × MEMBER_CACHE_MAX`, e não um teto global. Sem teto ela era
 * `guilds × membros do servidor` — a soma dos membros de todo mundo —, o que
 * com servidores de terceiros estoura os 384 MB do container antes de qualquer
 * outra coisa dar sinal.
 *
 * Duzentos não é um palpite sobre "quantos membros o servidor tem": é quantos
 * o bot precisa ter à mão ao mesmo tempo. O LRU guarda quem apareceu por
 * último, que é exatamente quem a moderação está tratando; qualquer outro sai
 * por `fetchMember`, uma chamada. Quem lista o servidor inteiro (a busca do
 * painel) pergunta ao gateway em vez de varrer o cache.
 */
export const MEMBER_CACHE_MAX = 200;

/** De quanto em quanto tempo o cache de membros e de usuários é esvaziado. */
export const MEMBER_SWEEP_INTERVAL_SECONDS = 3_600;

/**
 * Teto de uma chamada REST ao Discord. Explícito e não herdado do default do
 * discord.js: uma requisição pendurada segura o handler que a chamou, e desde
 * a v1.1 quem espera do outro lado pode ser o painel (PRD §7.5). O `@discordjs/rest`
 * aplica isto como `AbortSignal` em cada `fetch`, com uma tentativa de repetição.
 */
export const REST_TIMEOUT_MS = 15_000;

/**
 * Limites de cache pensados para a VM free tier (PRD §7.2): guardamos o que os
 * módulos realmente consultam (membros recentes, cargos, canais) e cortamos o
 * resto.
 */
export const clientOptions: ClientOptions = {
  intents: [...INTENTS],
  partials: [...PARTIALS],
  allowedMentions: { parse: [], repliedUser: false },
  rest: { timeout: REST_TIMEOUT_MS, retries: 1 },
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
    GuildMemberManager: {
      maxSize: MEMBER_CACHE_MAX,
      // O membro do próprio bot nunca pode ser despejado: `guild.members.me` é
      // quem responde "posso falar neste canal?" e "meu cargo está acima
      // deste?" — sem ele o bot perde a checagem de hierarquia inteira.
      keepOverLimit: (member) => member.id === member.client.user.id,
    },
  }),
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: { interval: 600, lifetime: 3600 },
    threads: { interval: 3600, lifetime: 14_400 },
    // O teto acima já segura o pico; o sweeper é quem devolve a memória de um
    // servidor que ficou quieto. Membro varrido volta num `fetch` — o preço
    // de errar aqui é uma chamada, não um bug.
    guildMembers: {
      interval: MEMBER_SWEEP_INTERVAL_SECONDS,
      filter: () => (member) => member.id !== member.client.user.id,
    },
    // `client.users` cresce junto com os membros (todo `GuildMember` aponta
    // para um `User`) e não aceita teto: limitar o `UserManager` arrisca
    // despejar o próprio `client.user`. Aqui a poda é por varredura.
    users: {
      interval: MEMBER_SWEEP_INTERVAL_SECONDS,
      filter: () => (user) => user.id !== user.client.user.id,
    },
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
