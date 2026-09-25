-- Buscar squad em três canais (PRD v2.0, §5.11). Escrita à mão sobre o que o
-- drizzle-kit gerou: o Postgres não remove valor de enum, então a troca de
-- `waiting` por `invited` passa por `text`, e quem estava na lista de espera
-- (que não existe mais) sai antes, senão o cast de volta para o enum falha.
DELETE FROM "lfg_session_members" WHERE "status" = 'waiting';--> statement-breakpoint
ALTER TABLE "lfg_session_members" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."lfg_member_status";--> statement-breakpoint
CREATE TYPE "public"."lfg_member_status" AS ENUM('host', 'going', 'requested', 'invited');--> statement-breakpoint
ALTER TABLE "lfg_session_members" ALTER COLUMN "status" SET DATA TYPE "public"."lfg_member_status" USING "status"::"public"."lfg_member_status";--> statement-breakpoint
ALTER TABLE "lfg_session_members" ADD COLUMN "invited_by" text;--> statement-breakpoint
CREATE TYPE "public"."lfg_kind" AS ENUM('now', 'scheduled');--> statement-breakpoint
ALTER TABLE "lfg_sessions" ADD COLUMN "kind" "lfg_kind" DEFAULT 'scheduled' NOT NULL;--> statement-breakpoint
ALTER TABLE "lfg_sessions" ADD COLUMN "promoted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lfg_sessions" DROP COLUMN "called_at";--> statement-breakpoint
CREATE UNIQUE INDEX "lfg_sessions_open_call_uidx" ON "lfg_sessions" USING btree ("guild_id","host_id") WHERE "lfg_sessions"."kind" = 'now' and "lfg_sessions"."status" in ('scheduled', 'live');
