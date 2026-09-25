/** Código do Postgres para violação de unique. */
const UNIQUE_VIOLATION = '23505';

/**
 * A escrita bateu num índice único (com `constraint`, naquele índice). O
 * Drizzle embrulha o `PostgresError` em `DrizzleQueryError`, e o código fica em
 * `cause`; o nome do índice vem em `constraint_name`.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    if (typeof current !== 'object') return false;
    const pg = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (pg.code === UNIQUE_VIOLATION) {
      return constraint === undefined || pg.constraint_name === constraint;
    }
    current = pg.cause;
  }
  return false;
}
