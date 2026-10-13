import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb } from './client';
import { loadRootEnv } from './env';

loadRootEnv();
const url = process.env.DATABASE_URL;

describe.skipIf(!url)('acesso ao banco pela API do Supabase', () => {
  let sql: ReturnType<typeof createDb>['sql'];

  beforeAll(() => {
    sql = createDb(url!, { max: 1 }).sql;
  });

  afterAll(async () => {
    await sql.end();
  });

  it('protege todas as tabelas public e suas sequências', async () => {
    const tables = await sql<{
      relname: string;
      relrowsecurity: boolean;
    }[]>`
      SELECT c.relname, c.relrowsecurity
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      ORDER BY c.relname
    `;
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.every((table) => table.relrowsecurity)).toBe(true);

    const access = await sql<{
      role_name: string;
      object_name: string;
      object_type: string;
      can_access: boolean;
    }[]>`
      SELECT roles.rolname AS role_name, c.relname AS object_name,
        c.relkind AS object_type,
        CASE WHEN c.relkind = 'S' THEN
          has_sequence_privilege(roles.oid, c.oid, 'USAGE')
          OR has_sequence_privilege(roles.oid, c.oid, 'SELECT')
          OR has_sequence_privilege(roles.oid, c.oid, 'UPDATE')
        ELSE
          has_table_privilege(roles.oid, c.oid, 'SELECT')
          OR has_table_privilege(roles.oid, c.oid, 'INSERT')
          OR has_table_privilege(roles.oid, c.oid, 'UPDATE')
          OR has_table_privilege(roles.oid, c.oid, 'DELETE')
          OR has_table_privilege(roles.oid, c.oid, 'TRUNCATE')
          OR has_table_privilege(roles.oid, c.oid, 'REFERENCES')
          OR has_table_privilege(roles.oid, c.oid, 'TRIGGER')
        END AS can_access
      FROM pg_catalog.pg_roles AS roles
      CROSS JOIN pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE roles.rolname IN ('anon', 'authenticated')
        AND n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S')
      ORDER BY roles.rolname, c.relname
    `;
    expect(access.every((entry) => !entry.can_access)).toBe(true);
  });

  it('não concede acesso de API por padrão a objetos futuros', async () => {
    const grants = await sql<{ role_name: string }[]>`
      SELECT COALESCE(roles.rolname, 'PUBLIC') AS role_name
      FROM pg_catalog.pg_default_acl AS defaults
      LEFT JOIN pg_catalog.pg_namespace AS n ON n.oid = defaults.defaclnamespace
      CROSS JOIN LATERAL aclexplode(defaults.defaclacl) AS grant_entry
      LEFT JOIN pg_catalog.pg_roles AS roles ON roles.oid = grant_entry.grantee
      WHERE (n.nspname = 'public' OR defaults.defaclnamespace = 0)
        AND defaults.defaclrole = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
        AND defaults.defaclobjtype IN ('r', 'S')
        AND (grant_entry.grantee = 0 OR roles.rolname IN ('anon', 'authenticated'))
    `;
    expect(grants).toEqual([]);
  });
});
