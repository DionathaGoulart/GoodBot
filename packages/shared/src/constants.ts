/**
 * Constantes do domínio. Única fonte de verdade para nomes de módulo, tipos de
 * caso, enums do banco e limites — bot, painel e `@goodbot/db` importam daqui.
 */

/** Módulos configuráveis (linhas de `module_configs`). */
export const MODULES = [
  'general',
  'moderation',
  'automod',
  'logs',
  'welcome',
  'autorole',
  'reaction_roles',
  'tickets',
  'tags',
  'utilities',
  'stats',
  'social',
] as const;
export type Module = (typeof MODULES)[number];

/**
 * Estado de um servidor no registro (`guild_registry`). É ele, e não uma
 * variável de ambiente, que decide se o bot atende a guild:
 *
 * · `pending` — entrou pelo convite normal e espera aprovação do dono do bot;
 * · `approved` — aprovado, atendido sem prazo;
 * · `demo` — entrou pelo link de demonstração; atendido até `expiresAt`;
 * · `blocked` — recusado ou bloqueado; o bot sai e não volta a atender.
 */
export const GUILD_STATUSES = ['pending', 'approved', 'demo', 'blocked'] as const;
export type GuildStatus = (typeof GUILD_STATUSES)[number];

/**
 * Os dois caminhos de entrada do bot (plano, Etapa 2). O convite do Discord
 * **não** conta ao bot por onde a pessoa veio, então cada fluxo tem o seu
 * próprio subdomínio (`invite.` e `demo.`): o link passa por nós, nós é que
 * chamamos o OAuth, e o `state` assinado devolve o fluxo no callback.
 *
 * `invite` entra como `pending` (espera aprovação); `demo` entra atendido e
 * com prazo.
 */
export const INVITE_FLOWS = ['invite', 'demo'] as const;
export type InviteFlow = (typeof INVITE_FLOWS)[number];

/** O status com que cada fluxo registra o servidor. */
export const INVITE_FLOW_STATUS: Record<InviteFlow, GuildStatus> = {
  invite: 'pending',
  demo: 'demo',
};

/** Tipos de caso de moderação (PRD §5.1). */
export const CASE_TYPES = [
  'ban',
  'unban',
  'softban',
  'kick',
  'timeout',
  'untimeout',
  'warn',
  'note',
] as const;
export type CaseType = (typeof CASE_TYPES)[number];

/** Origem de um caso (PRD §8). */
export const CASE_SOURCES = ['command', 'dashboard', 'automod', 'context', 'escalation'] as const;
export type CaseSource = (typeof CASE_SOURCES)[number];

/**
 * Origem de uma linha de `audit_logs` (PRD §6.5). Até a Etapa 22 a tabela só
 * guardava o que o painel fazia; agora ela conta também o que o bot faz
 * sozinho, e a origem é o que separa as duas histórias.
 *
 * · `dashboard` — mutação feita por alguém no painel;
 * · `command` — slash command ou menu de contexto no Discord;
 * · `automod` — regra do automod que disparou;
 * · `event` — reação do bot a um evento do gateway (entrada, reaction role);
 * · `job` — trabalho periódico (anúncio de rede social, retenção, scheduler).
 */
export const AUDIT_SOURCES = ['dashboard', 'command', 'automod', 'event', 'job'] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

/** Tipos de regra de automod (PRD §5.2). */
export const AUTOMOD_RULE_TYPES = ['spam', 'links', 'caps', 'words', 'mentions', 'raid'] as const;
export type AutomodRuleType = (typeof AUTOMOD_RULE_TYPES)[number];

/** Ações executáveis por uma regra de automod, em sequência (PRD §5.2). */
export const AUTOMOD_ACTIONS = [
  'delete',
  'warn',
  'timeout',
  'kick',
  'ban',
  'notify_modlog',
  'dm_user',
] as const;
export type AutomodAction = (typeof AUTOMOD_ACTIONS)[number];

/** Tipos de log com canal/toggle próprios (PRD §5.4). */
export const LOG_KINDS = ['modlog', 'messages', 'members', 'server', 'voice'] as const;
export type LogKind = (typeof LOG_KINDS)[number];

/** Tipos de métrica agregada em `stat_buckets` (PRD §5.6). */
export const STAT_KINDS = [
  'messages_channel',
  'messages_user',
  'joins',
  'leaves',
  'members_total',
  'voice_minutes_channel',
  'cases_type',
  'automod_rule',
  'commands',
  'tickets_open',
  'tickets_closed',
] as const;
export type StatKind = (typeof STAT_KINDS)[number];

export const STAT_GRANULARITIES = ['hour', 'day'] as const;
export type StatGranularity = (typeof STAT_GRANULARITIES)[number];

/** Níveis de permissão para comandos no Discord (PRD §9.1). */
export const PERMISSION_LEVELS = ['member', 'mod', 'admin'] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

/** Níveis de acesso ao painel (PRD §9.2). */
export const DASHBOARD_ROLES = ['mod', 'admin', 'owner'] as const;
export type DashboardRole = (typeof DASHBOARD_ROLES)[number];

/** Ações agendadas processadas pelo scheduler do bot (PRD §8). */
export const SCHEDULED_ACTION_KINDS = [
  'unban',
  'untimeout',
  'unlock',
  'reminder',
  'poll_close',
  /** Autorole com atraso longo: `setTimeout` não sobrevive a um restart. */
  'autorole',
] as const;
export type ScheduledActionKind = (typeof SCHEDULED_ACTION_KINDS)[number];

/**
 * Valores do enum `social_platform` no Postgres. Desde a v2 só `youtube` é
 * atendido (PRD §5.8): os outros três continuam aqui porque apagar valor de
 * enum no Postgres exige recriar o tipo, e nenhuma linha os usa. Quem quiser
 * saber o que o bot atende usa `SocialPlatform`, não esta lista.
 */
export const SOCIAL_PLATFORM_ENUM_VALUES = ['youtube', 'twitch', 'instagram', 'tiktok'] as const;

/** A única plataforma que o bot observa. */
export const SOCIAL_PLATFORM = 'youtube';
export type SocialPlatform = typeof SOCIAL_PLATFORM;

/**
 * Valores do enum `social_kind` no Postgres. `post` é herança da v1 (Instagram)
 * e não é mais produzido; fica pelo mesmo motivo das plataformas.
 */
export const SOCIAL_KIND_ENUM_VALUES = ['video', 'short', 'live', 'post'] as const;

/** O que uma conta pode anunciar. */
export const SOCIAL_KINDS = ['video', 'short', 'live'] as const;
export type SocialKind = (typeof SOCIAL_KINDS)[number];

export const REACTION_ROLE_MODES = ['single', 'multiple', 'toggle'] as const;
export type ReactionRoleMode = (typeof REACTION_ROLE_MODES)[number];

export const REACTION_ROLE_STYLES = ['buttons', 'select', 'reactions'] as const;
export type ReactionRoleStyle = (typeof REACTION_ROLE_STYLES)[number];

export const TICKET_STATUSES = ['open', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** As que descrevem um membro (PRD §5.5): entrada, saída e DM de boas-vindas. */
export const MEMBER_TEMPLATE_VARIABLES = [
  'user',
  'mention',
  'tag',
  'id',
  'server',
  'memberCount',
  'ordinal',
] as const;

/**
 * As do agradecimento de impulso. Ficam à parte porque só a mensagem de boost
 * sabe preencher: `{boostCount}` numa mensagem de entrada nunca teria valor.
 */
export const BOOST_TEMPLATE_VARIABLES = ['boostCount', 'boostTier'] as const;

/** As que descrevem uma publicação de rede social (PRD §5.8). */
export const SOCIAL_TEMPLATE_VARIABLES = [
  'title',
  'url',
  'author',
  'thumbnail',
  'platform',
  'kind',
  'headline',
] as const;

/**
 * Variáveis aceitas em templates de mensagem (PRD §5.5 e §5.8). O motor é o
 * mesmo para os dois grupos: quem não recebe valor fica literal no texto. Cada
 * tela oferece só o grupo que sabe preencher — `{memberCount}` num anúncio do
 * YouTube nunca teria valor.
 */
export const TEMPLATE_VARIABLES = [
  ...MEMBER_TEMPLATE_VARIABLES,
  ...BOOST_TEMPLATE_VARIABLES,
  ...SOCIAL_TEMPLATE_VARIABLES,
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

// ── Limites ─────────────────────────────────────────────────────────────────

export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

/**
 * Quanto tempo o bot atende um servidor que entrou pelo link de demonstração
 * (plano, Etapa 2). É fixo de propósito: a demo existe para mostrar o produto,
 * não para virar um plano gratuito com prazo negociável.
 */
export const DEMO_DURATION_MS = HOUR_MS;

/**
 * Validade do `state` assinado do convite. Curta porque ele só precisa
 * sobreviver ao tempo de escolher o servidor na tela do Discord; um `state`
 * antigo que vaze não serve para nada depois disso.
 */
export const INVITE_STATE_TTL_MS = 15 * MINUTE_MS;

/** Timeout nativo do Discord: no máximo 28 dias. */
export const MAX_TIMEOUT_MS = 28 * DAY_MS;
/** Máximo de mensagens por `/purge`. */
export const MAX_PURGE = 500;
/** Bulk delete do Discord só alcança mensagens com até 14 dias. */
export const BULK_DELETE_MAX_AGE_MS = 14 * DAY_MS;
/** `/slowmode` aceita de 0 a 6 horas (limite do Discord). */
export const MAX_SLOWMODE_SECONDS = 21_600;
/** Dias de mensagens apagáveis no ban (limite do Discord). */
export const MAX_BAN_DELETE_DAYS = 7;
/** Motivo no audit log do Discord: 512 caracteres. */
export const MAX_REASON_LENGTH = 512;
export const DEFAULT_REASON = '[sem motivo]';
export const MAX_MESSAGE_CONTENT_LENGTH = 2_000;
export const MAX_EMBED_DESCRIPTION_LENGTH = 4_096;
export const MAX_EMBED_TITLE_LENGTH = 256;
/** O Discord não documenta um teto para `embed.url`; 512 é folga suficiente. */
export const MAX_EMBED_URL_LENGTH = 512;
export const MAX_EMBED_FIELDS = 25;
export const MAX_EMBED_FIELD_NAME_LENGTH = 256;
export const MAX_EMBED_FIELD_VALUE_LENGTH = 1_024;
export const MAX_EMBED_FOOTER_LENGTH = 2_048;
export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 10;
/** Nome de tag/regra/tipo de ticket. */
export const MAX_NAME_LENGTH = 64;
/** Nome de slash command / menu de contexto (limite do Discord). */
export const MAX_COMMAND_NAME_LENGTH = 32;
/** Teto de um padrão de regex do filtro de palavras (PRD §7.3). */
export const MAX_REGEX_PATTERN_LENGTH = 200;
/** Retenções (PRD §8 e §5.6). */
export const MESSAGE_CACHE_RETENTION_DAYS = 7;
export const AUTOMOD_HITS_RETENTION_DAYS = 30;
export const STATS_HOURLY_RETENTION_DAYS = 90;
// `social_posts` não tem retenção de propósito: podar a linha faria uma
// publicação antiga voltar a ser "nova" no feed e ser anunciada de novo.

// ── Redes sociais (PRD §5.8) ────────────────────────────────────────────────

/** Contas por servidor. Cada conta são duas chamadas HTTP por passada. */
export const MAX_SOCIAL_ACCOUNTS = 20;
/** Intervalo do laço, igual para todas as contas da instância (PRD §5.8). */
export const SOCIAL_DEFAULT_POLL_SECONDS = 180;
export const SOCIAL_MIN_POLL_SECONDS = 60;
export const SOCIAL_MAX_POLL_SECONDS = 30 * 60;
/** Pausa entre duas contas na mesma passada, para não rajar no YouTube. */
export const SOCIAL_ACCOUNT_DELAY_MS = 500;
/** Falhas seguidas que desativam uma conta sozinha (PRD §5.8). */
export const SOCIAL_MAX_FAILURES = 10;

/**
 * Como cada tipo é chamado na interface. Mora aqui, e não no bot, porque o
 * painel escreve os mesmos rótulos na tabela de contas e no preview do
 * template: dois lugares dizendo "short" e "live" de jeitos diferentes seria
 * a mesma configuração com dois nomes.
 */
export const SOCIAL_KIND_LABEL: Record<SocialKind, string> = {
  video: 'vídeo',
  short: 'short',
  live: 'live',
};

/**
 * O que a frase do anúncio diz, por tipo — o valor de `{headline}`. Existe
 * porque um template só para os três tipos não tem verbo que sirva: "{author}
 * publicou" fica errado numa live, e "está ao vivo" fica errado num short.
 */
export const SOCIAL_KIND_HEADLINE: Record<SocialKind, string> = {
  video: 'publicou um vídeo novo',
  short: 'publicou um short',
  live: 'está ao vivo',
};

/** O valor de `{platform}`. Uma plataforma só desde a v2. */
export const SOCIAL_PLATFORM_LABEL: Record<SocialPlatform, string> = {
  youtube: 'YouTube',
};
