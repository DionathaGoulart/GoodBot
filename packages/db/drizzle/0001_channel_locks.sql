CREATE TABLE "channel_locks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"role_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"overwrites" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"locked_by" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_locks" ADD CONSTRAINT "channel_locks_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_locks_channel_uidx" ON "channel_locks" USING btree ("guild_id","channel_id");--> statement-breakpoint
CREATE INDEX "channel_locks_guild_idx" ON "channel_locks" USING btree ("guild_id");