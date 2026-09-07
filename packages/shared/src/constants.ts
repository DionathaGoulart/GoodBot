/**
 * Constantes do domínio. Única fonte de verdade para nomes de módulo, tipos de
 * caso, enums do banco e limites — bot, painel e `@cobot/db` importam daqui.
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
] as const;
export type Module = (typeof MODULES)[number];

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

export const REACTION_ROLE_MODES = ['single', 'multiple', 'toggle'] as const;
export type ReactionRoleMode = (typeof REACTION_ROLE_MODES)[number];

export const REACTION_ROLE_STYLES = ['buttons', 'select', 'reactions'] as const;
export type ReactionRoleStyle = (typeof REACTION_ROLE_STYLES)[number];

export const TICKET_STATUSES = ['open', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Variáveis aceitas em templates de mensagem (PRD §5.5). */
export const TEMPLATE_VARIABLES = [
  'user',
  'mention',
  'tag',
  'id',
  'server',
  'memberCount',
  'ordinal',
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

// ── Limites ─────────────────────────────────────────────────────────────────

export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

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
