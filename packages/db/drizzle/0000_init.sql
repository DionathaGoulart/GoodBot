CREATE TYPE "public"."automod_rule_type" AS ENUM('spam', 'links', 'caps', 'words', 'mentions', 'raid');--> statement-breakpoint
CREATE TYPE "public"."case_source" AS ENUM('command', 'dashboard', 'automod', 'context', 'escalation');--> statement-breakpoint
CREATE TYPE "public"."case_type" AS ENUM('ban', 'unban', 'softban', 'kick', 'timeout', 'untimeout', 'warn', 'note');--> statement-breakpoint
CREATE TYPE "public"."log_kind" AS ENUM('modlog', 'messages', 'members', 'server', 'voice');--> statement-breakpoint
CREATE TYPE "public"."module" AS ENUM('general', 'moderation', 'automod', 'logs', 'welcome', 'autorole', 'reaction_roles', 'tickets', 'tags', 'utilities', 'stats');--> statement-breakpoint
CREATE TYPE "public"."reaction_role_mode" AS ENUM('single', 'multiple', 'toggle');--> statement-breakpoint
CREATE TYPE "public"."reaction_role_style" AS ENUM('buttons', 'select', 'reactions');--> statement-breakpoint
CREATE TYPE "public"."scheduled_action_kind" AS ENUM('unban', 'untimeout', 'unlock', 'reminder', 'poll_close');--> statement-breakpoint
CREATE TYPE "public"."stat_granularity" AS ENUM('hour', 'day');--> statement-breakpoint
CREATE TYPE "public"."stat_kind" AS ENUM('messages_channel', 'messages_user', 'joins', 'leaves', 'members_total', 'voice_minutes_channel', 'cases_type', 'automod_rule', 'commands', 'tickets_open', 'tickets_closed');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "guilds" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"owner_id" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"embed_color" integer DEFAULT 14423100 NOT NULL,
	"mod_role_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"admin_role_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"dashboard_access_role_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"log_channel_id" text,
	"dm_on_punish" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "log_configs" (
	"guild_id" text NOT NULL,
	"kind" "log_kind" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"channel_id" text,
	"ignored_channel_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"ignored_role_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "log_configs_guild_id_kind_pk" PRIMARY KEY("guild_id","kind")
);
--> statement-breakpoint
CREATE TABLE "module_configs" (
	"guild_id" text NOT NULL,
	"module" "module" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "module_configs_guild_id_module_pk" PRIMARY KEY("guild_id","module")
);
--> statement-breakpoint
CREATE TABLE "automod_hits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"rule_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"channel_id" text,
	"message_id" text,
	"action_taken" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automod_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "automod_rule_type" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exempt_role_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"exempt_channel_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"case_number" integer NOT NULL,
	"type" "case_type" NOT NULL,
	"target_id" text NOT NULL,
	"target_tag" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_tag" text NOT NULL,
	"reason" text NOT NULL,
	"duration_ms" bigint,
	"expires_at" timestamp with time zone,
	"source" "case_source" DEFAULT 'command' NOT NULL,
	"automod_rule_id" uuid,
	"modlog_message_id" text,
	"modlog_channel_id" text,
	"edited_by" text,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_actions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"case_id" bigint,
	"kind" "scheduled_action_kind" NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_cache" (
	"message_id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"author_id" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "autorole_configs" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"human_role_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"bot_role_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"delay_s" integer DEFAULT 0 NOT NULL,
	"verify_enabled" boolean DEFAULT false NOT NULL,
	"verify_channel_id" text,
	"verify_message_id" text,
	"verify_role_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reaction_role_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"panel_id" uuid NOT NULL,
	"role_id" text NOT NULL,
	"emoji" text,
	"label" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reaction_role_panels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"mode" "reaction_role_mode" DEFAULT 'toggle' NOT NULL,
	"style" "reaction_role_style" DEFAULT 'buttons' NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_panels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"content" jsonb NOT NULL,
	"type_ids" uuid[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"category_id" text NOT NULL,
	"support_role_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"opening_message" jsonb,
	"max_open_per_user" integer,
	"naming_pattern" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"number" integer NOT NULL,
	"type_id" uuid,
	"user_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"claimed_by" text,
	"closed_by" text,
	"close_reason" text,
	"transcript_url" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "welcome_configs" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"join_enabled" boolean DEFAULT false NOT NULL,
	"join_channel_id" text,
	"join_template" jsonb,
	"leave_enabled" boolean DEFAULT false NOT NULL,
	"leave_channel_id" text,
	"leave_template" jsonb,
	"dm_enabled" boolean DEFAULT false NOT NULL,
	"dm_template" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"author_id" text NOT NULL,
	"question" text NOT NULL,
	"options" jsonb NOT NULL,
	"multiple" boolean DEFAULT false NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"votes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"channel_id" text,
	"text" text NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stat_buckets" (
	"guild_id" text NOT NULL,
	"kind" "stat_kind" NOT NULL,
	"key" text DEFAULT '_' NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"granularity" "stat_granularity" DEFAULT 'hour' NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "stat_buckets_guild_id_kind_key_bucket_start_granularity_pk" PRIMARY KEY("guild_id","kind","key","bucket_start","granularity")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_tag" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guild_settings" ADD CONSTRAINT "guild_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_configs" ADD CONSTRAINT "log_configs_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_configs" ADD CONSTRAINT "module_configs_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automod_hits" ADD CONSTRAINT "automod_hits_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automod_hits" ADD CONSTRAINT "automod_hits_rule_id_automod_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automod_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automod_rules" ADD CONSTRAINT "automod_rules_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_automod_rule_id_automod_rules_id_fk" FOREIGN KEY ("automod_rule_id") REFERENCES "public"."automod_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_actions" ADD CONSTRAINT "scheduled_actions_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_actions" ADD CONSTRAINT "scheduled_actions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_cache" ADD CONSTRAINT "message_cache_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autorole_configs" ADD CONSTRAINT "autorole_configs_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction_role_items" ADD CONSTRAINT "reaction_role_items_panel_id_reaction_role_panels_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."reaction_role_panels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction_role_panels" ADD CONSTRAINT "reaction_role_panels_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_panels" ADD CONSTRAINT "ticket_panels_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_type_id_ticket_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."ticket_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "welcome_configs" ADD CONSTRAINT "welcome_configs_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stat_buckets" ADD CONSTRAINT "stat_buckets_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "log_configs_guild_idx" ON "log_configs" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "automod_hits_guild_created_idx" ON "automod_hits" USING btree ("guild_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "automod_hits_rule_idx" ON "automod_hits" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "automod_rules_guild_priority_idx" ON "automod_rules" USING btree ("guild_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "cases_guild_number_uidx" ON "cases" USING btree ("guild_id","case_number");--> statement-breakpoint
CREATE INDEX "cases_guild_target_idx" ON "cases" USING btree ("guild_id","target_id");--> statement-breakpoint
CREATE INDEX "cases_guild_created_idx" ON "cases" USING btree ("guild_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "cases_guild_expires_idx" ON "cases" USING btree ("guild_id","expires_at") WHERE "cases"."expires_at" is not null;--> statement-breakpoint
CREATE INDEX "scheduled_actions_pending_idx" ON "scheduled_actions" USING btree ("run_at") WHERE "scheduled_actions"."done_at" is null;--> statement-breakpoint
CREATE INDEX "scheduled_actions_case_idx" ON "scheduled_actions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "message_cache_guild_channel_idx" ON "message_cache" USING btree ("guild_id","channel_id");--> statement-breakpoint
CREATE INDEX "message_cache_created_idx" ON "message_cache" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "reaction_role_items_panel_idx" ON "reaction_role_items" USING btree ("panel_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "reaction_role_items_panel_role_uidx" ON "reaction_role_items" USING btree ("panel_id","role_id");--> statement-breakpoint
CREATE INDEX "reaction_role_panels_guild_idx" ON "reaction_role_panels" USING btree ("guild_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reaction_role_panels_message_uidx" ON "reaction_role_panels" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_guild_name_uidx" ON "tags" USING btree ("guild_id","name");--> statement-breakpoint
CREATE INDEX "ticket_panels_guild_idx" ON "ticket_panels" USING btree ("guild_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_types_guild_name_uidx" ON "ticket_types" USING btree ("guild_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_guild_number_uidx" ON "tickets" USING btree ("guild_id","number");--> statement-breakpoint
CREATE INDEX "tickets_guild_user_status_idx" ON "tickets" USING btree ("guild_id","user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_channel_uidx" ON "tickets" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "polls_open_idx" ON "polls" USING btree ("ends_at") WHERE "polls"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "polls_message_idx" ON "polls" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "reminders_pending_idx" ON "reminders" USING btree ("run_at") WHERE "reminders"."done_at" is null;--> statement-breakpoint
CREATE INDEX "reminders_guild_user_idx" ON "reminders" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE INDEX "stat_buckets_guild_kind_start_idx" ON "stat_buckets" USING btree ("guild_id","kind","bucket_start");--> statement-breakpoint
CREATE INDEX "audit_logs_guild_created_idx" ON "audit_logs" USING btree ("guild_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "audit_logs_guild_actor_idx" ON "audit_logs" USING btree ("guild_id","actor_id");