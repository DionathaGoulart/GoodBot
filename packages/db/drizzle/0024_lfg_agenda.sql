CREATE TYPE "public"."lfg_member_status" AS ENUM('host', 'going', 'waiting', 'requested');--> statement-breakpoint
CREATE TYPE "public"."lfg_session_status" AS ENUM('scheduled', 'live', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."lfg_visibility" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "lfg_session_members" (
	"session_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" "lfg_member_status" NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lfg_session_members_session_id_user_id_pk" PRIMARY KEY("session_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "lfg_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"host_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"slots" integer NOT NULL,
	"visibility" "lfg_visibility" DEFAULT 'open' NOT NULL,
	"note" text,
	"status" "lfg_session_status" DEFAULT 'scheduled' NOT NULL,
	"channel_id" text,
	"message_id" text,
	"thread_id" text,
	"room_id" text,
	"reminded_at" timestamp with time zone,
	"called_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lfg_session_members" ADD CONSTRAINT "lfg_session_members_session_id_lfg_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lfg_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lfg_sessions" ADD CONSTRAINT "lfg_sessions_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lfg_session_members_user_idx" ON "lfg_session_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "lfg_sessions_guild_starts_idx" ON "lfg_sessions" USING btree ("guild_id","starts_at");--> statement-breakpoint
CREATE INDEX "lfg_sessions_open_idx" ON "lfg_sessions" USING btree ("starts_at") WHERE "lfg_sessions"."status" in ('scheduled', 'live');--> statement-breakpoint
CREATE UNIQUE INDEX "lfg_sessions_message_uidx" ON "lfg_sessions" USING btree ("message_id");