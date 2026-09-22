CREATE TABLE "squad_session_guests" (
	"guild_id" text NOT NULL,
	"session_id" bigint NOT NULL,
	"user_id" text NOT NULL,
	"invited_by" text NOT NULL,
	"thread_id" text,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "squad_session_guests_session_id_user_id_pk" PRIMARY KEY("session_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "squad_session_attendance" ADD COLUMN "as_guest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "squad_session_guests" ADD CONSTRAINT "squad_session_guests_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_session_guests" ADD CONSTRAINT "squad_session_guests_session_id_squad_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."squad_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "squad_session_guests_guild_user_idx" ON "squad_session_guests" USING btree ("guild_id","user_id");