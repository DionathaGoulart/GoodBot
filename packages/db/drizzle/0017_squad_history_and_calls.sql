-- Squads v2, etapa 4: histórico e chamada pública.
-- `squad_session_attendance` guarda quem do squad esteve no voice reservado de
-- cada jogatina (uma linha por entrada), que é o que o histórico conta.
-- A jogatina ganha a chamada pública do CHAMAR GENTE: `called_at` é a trava de
-- uma chamada por jogatina, e canal e mensagem dizem o que apagar no início.
-- O pedido de entrada que veio dessa chamada aponta para a jogatina.
-- Tudo nulo ou tabela nova: o bot publicado antes do deploy continua lendo e
-- escrevendo sem saber das colunas.
CREATE TABLE "squad_session_attendance" (
	"guild_id" text NOT NULL,
	"session_id" bigint NOT NULL,
	"user_id" text NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "squad_session_attendance_session_id_user_id_joined_at_pk" PRIMARY KEY("session_id","user_id","joined_at")
);
--> statement-breakpoint
ALTER TABLE "squad_join_requests" ADD COLUMN "session_id" bigint;--> statement-breakpoint
ALTER TABLE "squad_sessions" ADD COLUMN "called_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squad_sessions" ADD COLUMN "call_channel_id" text;--> statement-breakpoint
ALTER TABLE "squad_sessions" ADD COLUMN "call_message_id" text;--> statement-breakpoint
ALTER TABLE "squad_session_attendance" ADD CONSTRAINT "squad_session_attendance_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_session_attendance" ADD CONSTRAINT "squad_session_attendance_session_id_squad_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."squad_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "squad_session_attendance_guild_user_idx" ON "squad_session_attendance" USING btree ("guild_id","user_id");--> statement-breakpoint
ALTER TABLE "squad_join_requests" ADD CONSTRAINT "squad_join_requests_session_id_squad_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."squad_sessions"("id") ON DELETE set null ON UPDATE no action;