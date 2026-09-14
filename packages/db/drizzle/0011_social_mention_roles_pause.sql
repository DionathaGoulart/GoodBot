ALTER TABLE "social_accounts" ADD COLUMN "mention_role_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "live_mention_role_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "paused_until" timestamp with time zone;--> statement-breakpoint
-- Cada anúncio passa a pingar uma lista de cargos. O cargo único de cada tipo
-- vira o único item da lista, então toda conta existente continua pingando
-- exatamente como antes. As colunas antigas só saem na migration seguinte,
-- depois desta cópia.
UPDATE "social_accounts" SET "mention_role_ids" = ARRAY["mention_role_id"] WHERE "mention_role_id" IS NOT NULL;--> statement-breakpoint
UPDATE "social_accounts" SET "live_mention_role_ids" = ARRAY["live_mention_role_id"] WHERE "live_mention_role_id" IS NOT NULL;--> statement-breakpoint
-- Até aqui a décima falha seguida desligava a conta (`enabled = false` com
-- `disabled_reason`). Desde esta versão o bot só pausa, e `enabled = false` é
-- sempre decisão humana. A conta que o bot desligou volta ligada e com a pausa
-- já vencida: a primeira passada depois do deploy tenta de novo.
UPDATE "social_accounts" SET "enabled" = true, "paused_until" = now() WHERE "enabled" = false AND "disabled_reason" IS NOT NULL;
