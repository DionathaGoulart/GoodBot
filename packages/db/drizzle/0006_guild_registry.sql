CREATE TYPE "public"."guild_status" AS ENUM('pending', 'approved', 'demo', 'blocked');--> statement-breakpoint
CREATE TABLE "guild_registry" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"status" "guild_status" DEFAULT 'pending' NOT NULL,
	"invited_by" text,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "guild_registry_status_idx" ON "guild_registry" USING btree ("status");--> statement-breakpoint
CREATE INDEX "guild_registry_expires_idx" ON "guild_registry" USING btree ("expires_at") WHERE "guild_registry"."expires_at" is not null;