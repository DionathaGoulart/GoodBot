/** Código do Postgres para violação de unique. */
const UNIQUE_VIOLATION = '23505';

/**
 * A escrita bateu num índice único. O Drizzle embrulha o `PostgresError` em
 * `DrizzleQueryError`, e o código fica em `cause`.
 */
export function isUniqueViolation(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    if (typeof current !== 'object') return false;
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
