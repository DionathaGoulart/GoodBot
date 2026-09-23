DROP TABLE "squad_games" CASCADE;--> statement-breakpoint
DROP TABLE "squad_join_requests" CASCADE;--> statement-breakpoint
DROP TABLE "squad_members" CASCADE;--> statement-breakpoint
DROP TABLE "squad_profiles" CASCADE;--> statement-breakpoint
DROP TABLE "squad_proposals" CASCADE;--> statement-breakpoint
DROP TABLE "squad_session_attendance" CASCADE;--> statement-breakpoint
DROP TABLE "squad_session_guests" CASCADE;--> statement-breakpoint
DROP TABLE "squad_sessions" CASCADE;--> statement-breakpoint
DROP TABLE "squads" CASCADE;--> statement-breakpoint
DROP TYPE "public"."squad_profile_status";--> statement-breakpoint
DROP TYPE "public"."squad_request_status";--> statement-breakpoint
DROP TYPE "public"."squad_status";--> statement-breakpoint
DELETE FROM "meta" WHERE "key" LIKE 'squads\_daily:%';
