-- Contas das plataformas que saíram na v2. O código que as atendia não existe
-- mais, então a linha só serviria para o job falhar dez vezes e se desligar
-- sozinha. `social_posts` some junto pela FK com ON DELETE CASCADE.
DELETE FROM "social_accounts" WHERE "platform" <> 'youtube';--> statement-breakpoint
DROP INDEX "social_accounts_due_idx";--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "social_accounts" DROP COLUMN "poll_interval_s";--> statement-breakpoint
ALTER TABLE "social_accounts" DROP COLUMN "last_external_id";
