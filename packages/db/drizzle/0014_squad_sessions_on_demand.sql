-- Squads v2: jogatina sob demanda. O squad deixa de ter janela semanal; `day`
-- e `block` ficam nulos por uma versão (o painel publicado ainda os lê) e saem
-- na migration seguinte, junto com `reminder_message_id`.
ALTER TABLE "squads" ALTER COLUMN "day" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "squads" ALTER COLUMN "block" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "squads" ADD COLUMN "guide_message_id" text;--> statement-breakpoint
ALTER TABLE "squad_sessions" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "squad_sessions" ADD COLUMN "message_id" text;--> statement-breakpoint
ALTER TABLE "squad_sessions" ADD COLUMN "played_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squad_sessions" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squad_sessions" ADD COLUMN "cancelled_by" text;--> statement-breakpoint
-- A sessão semanal já lembrada tem a mensagem com Vou / Não vou: ela passa a
-- ser a mensagem da jogatina, e os votos continuam editando a contagem.
UPDATE "squad_sessions" SET "message_id" = "reminder_message_id" WHERE "reminder_message_id" IS NOT NULL;
