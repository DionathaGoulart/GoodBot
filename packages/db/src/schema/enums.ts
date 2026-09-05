import {
  AUTOMOD_RULE_TYPES,
  CASE_SOURCES,
  CASE_TYPES,
  LOG_KINDS,
  MODULES,
  REACTION_ROLE_MODES,
  REACTION_ROLE_STYLES,
  SCHEDULED_ACTION_KINDS,
  STAT_GRANULARITIES,
  STAT_KINDS,
  TICKET_STATUSES,
} from '@cobot/shared';
import { pgEnum } from 'drizzle-orm/pg-core';

/** Enums do Postgres gerados a partir das listas de `@cobot/shared`. */
export const moduleEnum = pgEnum('module', MODULES);
export const caseTypeEnum = pgEnum('case_type', CASE_TYPES);
export const caseSourceEnum = pgEnum('case_source', CASE_SOURCES);
export const scheduledActionKindEnum = pgEnum('scheduled_action_kind', SCHEDULED_ACTION_KINDS);
export const automodRuleTypeEnum = pgEnum('automod_rule_type', AUTOMOD_RULE_TYPES);
export const logKindEnum = pgEnum('log_kind', LOG_KINDS);
export const reactionRoleModeEnum = pgEnum('reaction_role_mode', REACTION_ROLE_MODES);
export const reactionRoleStyleEnum = pgEnum('reaction_role_style', REACTION_ROLE_STYLES);
export const ticketStatusEnum = pgEnum('ticket_status', TICKET_STATUSES);
export const statKindEnum = pgEnum('stat_kind', STAT_KINDS);
export const statGranularityEnum = pgEnum('stat_granularity', STAT_GRANULARITIES);
