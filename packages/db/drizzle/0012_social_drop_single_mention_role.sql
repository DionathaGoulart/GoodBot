-- Os cargos únicos já foram copiados para `mention_role_ids` e
-- `live_mention_role_ids` na 0011, que roda antes desta no mesmo migrate.
ALTER TABLE "social_accounts" DROP COLUMN "mention_role_id";--> statement-breakpoint
ALTER TABLE "social_accounts" DROP COLUMN "live_mention_role_id";
