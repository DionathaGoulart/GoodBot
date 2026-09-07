CREATE TYPE "public"."social_kind" AS ENUM('video', 'short', 'live', 'post');--> statement-breakpoint
CREATE TYPE "public"."social_platform" AS ENUM('youtube', 'twitch', 'instagram', 'tiktok');--> statement-breakpoint
ALTER TYPE "public"."module" ADD VALUE 'social';--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"platform" "social_platform" NOT NULL,
	"external_id" text NOT NULL,
	"handle" text,
	"display_name" text,
	"discord_channel_id" text NOT NULL,
	"kinds" "social_kind"[] DEFAULT '{}' NOT NULL,
	"template" jsonb NOT NULL,
	"mention_role_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"poll_interval_s" integer DEFAULT 300 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_external_id" text,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"disabled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"kind" "social_kind" NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"published_at" timestamp with time zone,
	"announced_at" timestamp with time zone,
	"message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_account_id_social_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_guild_platform_external_uidx" ON "social_accounts" USING btree ("guild_id","platform","external_id");--> statement-breakpoint
CREATE INDEX "social_accounts_due_idx" ON "social_accounts" USING btree ("enabled","last_checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_posts_account_external_uidx" ON "social_posts" USING btree ("account_id","external_id");--> statement-breakpoint
CREATE INDEX "social_posts_guild_created_idx" ON "social_posts" USING btree ("guild_id","created_at");