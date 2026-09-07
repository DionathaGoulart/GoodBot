/**
 * Move o item de `index` uma casa na direção pedida. `null` quando não dá (já
 * está na borda) — quem chama usa isso para desabilitar o botão em vez de
 * mandar ao servidor uma ordem idêntica à atual.
 */
export function moveRow<T>(items: readonly T[], index: number, delta: -1 | 1): T[] | null {
  const target = index + delta;
  if (target < 0 || target >= items.length) return null;
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved as T);
  return next;
}
