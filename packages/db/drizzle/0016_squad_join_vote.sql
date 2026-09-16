-- Squads v2: entrar num squad existente vira duas fases. O candidato recebe um
-- convite (`invited`) numa thread privada do canal de busca e, ao aceitar, o
-- squad vota (`pending`). O voto a favor ganha coluna própria; `declined_ids`
-- passa a ser o voto contra.
-- O índice de "um pedido aberto por pessoa e squad" cobre os dois status, mas é
-- escrito pelos status que ficam de fora: o migrator roda tudo numa transação
-- só, e o Postgres recusa usar `'invited'` antes do commit do `ADD VALUE`.
ALTER TYPE "public"."squad_request_status" ADD VALUE 'invited' BEFORE 'pending';--> statement-breakpoint
DROP INDEX "squad_join_requests_pending_uidx";--> statement-breakpoint
ALTER TABLE "squad_join_requests" ADD COLUMN "invited_by" text;--> statement-breakpoint
ALTER TABLE "squad_join_requests" ADD COLUMN "thread_id" text;--> statement-breakpoint
ALTER TABLE "squad_join_requests" ADD COLUMN "invite_message_id" text;--> statement-breakpoint
ALTER TABLE "squad_join_requests" ADD COLUMN "accepted_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- O prazo era contado de `created_at` pelo job; o pedido antigo ganha o mesmo
-- prazo com o `proposalTtlHours` padrão (72 h). A coluna só vira NOT NULL
-- depois do backfill: com pedido gravado, um ADD COLUMN NOT NULL sem default falha.
ALTER TABLE "squad_join_requests" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
UPDATE "squad_join_requests" SET "expires_at" = "created_at" + interval '72 hours';--> statement-breakpoint
ALTER TABLE "squad_join_requests" ALTER COLUMN "expires_at" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "squad_join_requests_open_uidx" ON "squad_join_requests" USING btree ("squad_id","user_id") WHERE "squad_join_requests"."status" not in ('accepted', 'declined', 'expired');--> statement-breakpoint
CREATE INDEX "squad_join_requests_open_expires_idx" ON "squad_join_requests" USING btree ("guild_id","expires_at") WHERE "squad_join_requests"."status" not in ('accepted', 'declined', 'expired');
