CREATE TYPE "public"."squad_profile_status" AS ENUM('searching', 'in_squad', 'paused');--> statement-breakpoint
CREATE TYPE "public"."squad_request_status" AS ENUM('pending', 'accepted', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."squad_status" AS ENUM('open', 'full', 'archived');--> statement-breakpoint
ALTER TYPE "public"."module" ADD VALUE 'squads';--> statement-breakpoint
CREATE TABLE "squad_games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"squad_size" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "squad_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"squad_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"message_id" text,
	"status" "squad_request_status" DEFAULT 'pending' NOT NULL,
	"declined_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"decided_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "squad_members" (
	"guild_id" text NOT NULL,
	"squad_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "squad_members_squad_id_user_id_pk" PRIMARY KEY("squad_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "squad_profiles" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"game_id" uuid NOT NULL,
	"availability" integer DEFAULT 0 NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "squad_profile_status" DEFAULT 'searching' NOT NULL,
	"last_matched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "squad_profiles_guild_id_user_id_game_id_pk" PRIMARY KEY("guild_id","user_id","game_id")
);
--> statement-breakpoint
CREATE TABLE "squad_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"game_id" uuid NOT NULL,
	"user_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"thread_id" text NOT NULL,
	"message_id" text,
	"accepted_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"declined_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"squad_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "squad_sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"squad_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reminded_at" timestamp with time zone,
	"reminder_message_id" text,
	"started_at" timestamp with time zone,
	"going_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"not_going_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"voice_channel_id" text,
	"voice_overwrites" jsonb,
	"voice_reserved_at" timestamp with time zone,
	"voice_released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "squads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"game_id" uuid NOT NULL,
	"name" text NOT NULL,
	"text_channel_id" text,
	"voice_channel_id" text,
	"day" smallint NOT NULL,
	"block" smallint NOT NULL,
	"status" "squad_status" DEFAULT 'open' NOT NULL,
	"last_confirmed_at" timestamp with time zone,
	"warned_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "squad_games" ADD CONSTRAINT "squad_games_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_join_requests" ADD CONSTRAINT "squad_join_requests_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_join_requests" ADD CONSTRAINT "squad_join_requests_squad_id_squads_id_fk" FOREIGN KEY ("squad_id") REFERENCES "public"."squads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_members" ADD CONSTRAINT "squad_members_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_members" ADD CONSTRAINT "squad_members_squad_id_squads_id_fk" FOREIGN KEY ("squad_id") REFERENCES "public"."squads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_profiles" ADD CONSTRAINT "squad_profiles_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_profiles" ADD CONSTRAINT "squad_profiles_game_id_squad_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."squad_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_proposals" ADD CONSTRAINT "squad_proposals_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_proposals" ADD CONSTRAINT "squad_proposals_game_id_squad_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."squad_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_proposals" ADD CONSTRAINT "squad_proposals_squad_id_squads_id_fk" FOREIGN KEY ("squad_id") REFERENCES "public"."squads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_sessions" ADD CONSTRAINT "squad_sessions_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_sessions" ADD CONSTRAINT "squad_sessions_squad_id_squads_id_fk" FOREIGN KEY ("squad_id") REFERENCES "public"."squads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squads" ADD CONSTRAINT "squads_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squads" ADD CONSTRAINT "squads_game_id_squad_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."squad_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "squad_games_guild_name_uidx" ON "squad_games" USING btree ("guild_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "squad_join_requests_pending_uidx" ON "squad_join_requests" USING btree ("squad_id","user_id") WHERE "squad_join_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "squad_join_requests_guild_status_idx" ON "squad_join_requests" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX "squad_members_guild_user_idx" ON "squad_members" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE INDEX "squad_profiles_guild_game_status_idx" ON "squad_profiles" USING btree ("guild_id","game_id","status");--> statement-breakpoint
CREATE INDEX "squad_proposals_open_idx" ON "squad_proposals" USING btree ("guild_id","expires_at") WHERE "squad_proposals"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "squad_proposals_guild_game_created_idx" ON "squad_proposals" USING btree ("guild_id","game_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "squad_proposals_thread_uidx" ON "squad_proposals" USING btree ("guild_id","thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "squad_sessions_squad_starts_uidx" ON "squad_sessions" USING btree ("squad_id","starts_at");--> statement-breakpoint
CREATE INDEX "squad_sessions_to_release_idx" ON "squad_sessions" USING btree ("guild_id","ends_at") WHERE "squad_sessions"."voice_reserved_at" is not null and "squad_sessions"."voice_released_at" is null;--> statement-breakpoint
CREATE INDEX "squad_sessions_guild_starts_idx" ON "squad_sessions" USING btree ("guild_id","starts_at");--> statement-breakpoint
CREATE INDEX "squads_guild_game_status_idx" ON "squads" USING btree ("guild_id","game_id","status");