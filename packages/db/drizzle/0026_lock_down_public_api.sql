-- CoBot usa uma conexão Postgres no servidor. Nenhuma tabela da aplicação
-- precisa ser acessível pelas roles da API pública do Supabase.
DO $$
DECLARE
  table_name text;
  table_oid oid;
  sequence_record record;
  api_role text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'audit_logs', 'automod_hits', 'automod_rules', 'autorole_configs',
    'cases', 'channel_locks', 'guild_registry', 'guild_settings', 'guilds',
    'lfg_session_members', 'lfg_sessions', 'log_configs', 'message_cache',
    'meta', 'module_configs', 'polls', 'reaction_role_items',
    'reaction_role_panels', 'reminders', 'scheduled_actions',
    'social_accounts', 'social_posts', 'stat_buckets', 'tags',
    'ticket_panels', 'ticket_types', 'tickets', 'welcome_configs'
  ] LOOP
    SELECT c.oid INTO table_oid
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = table_name
      AND c.relkind IN ('r', 'p');

    IF table_oid IS NULL THEN
      RAISE EXCEPTION 'Expected CoBot table public.% is missing', table_name;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', table_name);

    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = api_role) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', table_name, api_role);
      END IF;
    END LOOP;

    -- Sequências SERIAL/IDENTITY podem receber privilégios separados das tabelas.
    FOR sequence_record IN
      SELECT DISTINCT seq_namespace.nspname AS schema_name, seq.relname AS sequence_name
      FROM pg_catalog.pg_depend AS dependency
      JOIN pg_catalog.pg_class AS seq ON seq.oid = dependency.objid
      JOIN pg_catalog.pg_namespace AS seq_namespace ON seq_namespace.oid = seq.relnamespace
      WHERE dependency.refobjid = table_oid
        AND dependency.deptype IN ('a', 'i')
        AND seq.relkind = 'S'
    LOOP
      EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE %I.%I FROM PUBLIC',
        sequence_record.schema_name, sequence_record.sequence_name);
      FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = api_role) THEN
          EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE %I.%I FROM %I',
            sequence_record.schema_name, sequence_record.sequence_name, api_role);
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- Supabase concede privilégios de API por padrão em novas tabelas e
  -- sequências criadas pelo dono atual (postgres em produção).
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC';
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
