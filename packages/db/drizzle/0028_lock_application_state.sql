ALTER TABLE "channel_locks" ADD COLUMN "applied_at" timestamp with time zone;
-- Locks legados ficam pendentes: o fluxo anterior gravava antes do REST e
-- não permite comprovar aplicação. Reconciliar com o Discord antes de restaurar.
