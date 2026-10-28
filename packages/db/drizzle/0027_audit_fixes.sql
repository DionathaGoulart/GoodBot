CREATE TABLE "ticket_counters" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"last_number" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ticket_open_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type_id" uuid,
	"number" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_open_reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "scheduled_actions_pending_idx";--> statement-breakpoint
ALTER TABLE "scheduled_actions" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scheduled_actions" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "scheduled_actions" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_actions" ADD COLUMN "failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scheduled_actions" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "source_health" jsonb DEFAULT '{"feed":{"failureCount":0,"lastSuccessAt":null,"lastFailureAt":null,"lastError":null},"live":{"failureCount":0,"lastSuccessAt":null,"lastFailureAt":null,"lastError":null}}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_counters" ADD CONSTRAINT "ticket_counters_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_open_reservations" ADD CONSTRAINT "ticket_open_reservations_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_open_reservations_user_idx" ON "ticket_open_reservations" USING btree ("guild_id","user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_open_reservations_number_uidx" ON "ticket_open_reservations" USING btree ("guild_id","number");--> statement-breakpoint
CREATE INDEX "tickets_inactive_idx" ON "tickets" USING btree ("guild_id","last_activity_at") WHERE "tickets"."status" = 'open';--> statement-breakpoint
CREATE INDEX "scheduled_actions_pending_idx" ON "scheduled_actions" USING btree ("run_at") WHERE "scheduled_actions"."done_at" is null and "scheduled_actions"."failed_at" is null;
--> statement-breakpoint
-- Tarefas anteriores à versão com lockId só podem usar um snapshot que já
-- existia quando foram agendadas; nunca um lock criado posteriormente.
UPDATE scheduled_actions AS action
SET payload = action.payload || jsonb_build_object('lockId', lock.id)
FROM channel_locks AS lock
WHERE action.kind = 'unlock' AND action.done_at IS NULL
  AND action.payload ->> 'lockId' IS NULL
  AND action.guild_id = lock.guild_id
  AND action.payload ->> 'channelId' = lock.channel_id
  AND lock.created_at <= action.created_at;
--> statement-breakpoint
DO $$
DECLARE api_role text;
BEGIN
  REVOKE ALL PRIVILEGES ON TABLE public.ticket_counters, public.ticket_open_reservations FROM PUBLIC;
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.ticket_counters, public.ticket_open_reservations FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
