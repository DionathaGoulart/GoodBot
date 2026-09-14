import {
  AUDIT_SOURCES,
  AUTOMOD_RULE_TYPES,
  CASE_SOURCES,
  CASE_TYPES,
  GUILD_STATUSES,
  LOG_KINDS,
  MODULES,
  REACTION_ROLE_MODES,
  REACTION_ROLE_STYLES,
  SCHEDULED_ACTION_KINDS,
  SOCIAL_KIND_ENUM_VALUES,
  SOCIAL_PLATFORM_ENUM_VALUES,
  SQUAD_PROFILE_STATUSES,
  SQUAD_REQUEST_STATUSES,
  SQUAD_STATUSES,
  STAT_GRANULARITIES,
  STAT_KINDS,
  TICKET_STATUSES,
} from '@goodbot/shared';
import { pgEnum } from 'drizzle-orm/pg-core';

/** Enums do Postgres gerados a partir das listas de `@goodbot/shared`. */
export const moduleEnum = pgEnum('module', MODULES);
export const guildStatusEnum = pgEnum('guild_status', GUILD_STATUSES);
export const caseTypeEnum = pgEnum('case_type', CASE_TYPES);
export const caseSourceEnum = pgEnum('case_source', CASE_SOURCES);
export const auditSourceEnum = pgEnum('audit_source', AUDIT_SOURCES);
export const scheduledActionKindEnum = pgEnum('scheduled_action_kind', SCHEDULED_ACTION_KINDS);
export const automodRuleTypeEnum = pgEnum('automod_rule_type', AUTOMOD_RULE_TYPES);
export const logKindEnum = pgEnum('log_kind', LOG_KINDS);
export const reactionRoleModeEnum = pgEnum('reaction_role_mode', REACTION_ROLE_MODES);
export const reactionRoleStyleEnum = pgEnum('reaction_role_style', REACTION_ROLE_STYLES);
export const ticketStatusEnum = pgEnum('ticket_status', TICKET_STATUSES);
export const statKindEnum = pgEnum('stat_kind', STAT_KINDS);
export const statGranularityEnum = pgEnum('stat_granularity', STAT_GRANULARITIES);
export const socialPlatformEnum = pgEnum('social_platform', SOCIAL_PLATFORM_ENUM_VALUES);
export const socialKindEnum = pgEnum('social_kind', SOCIAL_KIND_ENUM_VALUES);
export const squadProfileStatusEnum = pgEnum('squad_profile_status', SQUAD_PROFILE_STATUSES);
export const squadStatusEnum = pgEnum('squad_status', SQUAD_STATUSES);
export const squadRequestStatusEnum = pgEnum('squad_request_status', SQUAD_REQUEST_STATUSES);
