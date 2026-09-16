-- Squads v2: fim das colunas do modelo semanal. `squads.day`/`block` (janela
-- fixa), `squad_games.squad_size` (tamanho único, copiado para `group_size` e
-- `party_size` na 0015) e `squad_sessions.reminder_message_id` (copiada para
-- `message_id` na 0014) estavam nulas e sem escrita desde a v1.6.
-- Só pode subir depois que o bot e o painel publicados pararem de declarar as
-- colunas no schema do Drizzle, que as nomeia em todo select e returning: o
-- deploy anterior (commit `refactor(db): stop reading the legacy squad columns`)
-- fez isso sem migration.
ALTER TABLE "squad_games" DROP COLUMN "squad_size";--> statement-breakpoint
ALTER TABLE "squad_sessions" DROP COLUMN "reminder_message_id";--> statement-breakpoint
ALTER TABLE "squads" DROP COLUMN "day";--> statement-breakpoint
ALTER TABLE "squads" DROP COLUMN "block";