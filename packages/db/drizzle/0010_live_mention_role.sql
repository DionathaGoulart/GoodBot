ALTER TABLE "social_accounts" ADD COLUMN "live_mention_role_id" text;--> statement-breakpoint
-- Até aqui um cargo só pingava vídeo, short e live. Copiar o cargo para a live
-- mantém cada conta existente pingando exatamente como antes.
UPDATE "social_accounts" SET "live_mention_role_id" = "mention_role_id";