/** O Discord aceita no máximo 25 sugestões por autocomplete. */
export const AUTOCOMPLETE_LIMIT = 25;

/**
 * Sugestões do autocomplete de `/tag`: quem começa com o que foi digitado vem
 * primeiro, depois quem só contém. A ordem relativa da lista de entrada (já
 * alfabética, vinda do banco) é preservada dentro de cada grupo.
 */
export function matchTagNames(
  names: readonly string[],
  query: string,
  limit = AUTOCOMPLETE_LIMIT,
): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return names.slice(0, limit);

  const prefix: string[] = [];
  const contains: string[] = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower.startsWith(needle)) prefix.push(name);
    else if (lower.includes(needle)) contains.push(name);
  }
  return [...prefix, ...contains].slice(0, limit);
}
