-- Squads v2: grupo maior que a party. O jogo passa a ter dois tamanhos, o do
-- squad inteiro (`group_size`) e o de quem joga junto (`party_size`). Todo jogo
-- antigo tinha squad do tamanho da party, então os dois nascem de `squad_size`.
-- As colunas entram nulas e só viram NOT NULL depois do backfill: com jogo
-- cadastrado, um ADD COLUMN NOT NULL sem default falha.
-- `squad_size` fica, nula e sem escrita, para o bot e o painel publicados não
-- quebrarem antes do deploy novo; sai junto com `squads.day`/`block`.
ALTER TABLE "squad_games" ALTER COLUMN "squad_size" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "squad_games" ADD COLUMN "group_size" integer;--> statement-breakpoint
ALTER TABLE "squad_games" ADD COLUMN "party_size" integer;--> statement-breakpoint
UPDATE "squad_games" SET "group_size" = "squad_size", "party_size" = "squad_size";--> statement-breakpoint
ALTER TABLE "squad_games" ALTER COLUMN "group_size" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "squad_games" ALTER COLUMN "party_size" SET NOT NULL;
