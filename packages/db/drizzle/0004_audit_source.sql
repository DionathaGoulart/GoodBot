CREATE TYPE "public"."audit_source" AS ENUM('dashboard', 'command', 'automod', 'event', 'job');--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "source" "audit_source" DEFAULT 'dashboard' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "reason" text;--> statement-breakpoint
CREATE INDEX "audit_logs_guild_source_created_idx" ON "audit_logs" USING btree ("guild_id","source","created_at" desc);