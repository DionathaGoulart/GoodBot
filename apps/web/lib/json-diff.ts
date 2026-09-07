/**
 * Diff entre o `before` e o `after` de uma linha de auditoria (PRD §6.5).
 * Puro: o componente que pinta as cores é `components/json-diff.tsx`.
 */

export type DiffKind = 'added' | 'removed' | 'changed';

export interface DiffEntry {
  /** Caminho até o campo: `escalation.warns`, `roleIds[2]`. */
  path: string;
  kind: DiffKind;
  before: unknown;
  after: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null;
}

function join(prefix: string, key: string): string {
  return prefix ? `${prefix}.${key}` : key;
}

/** Igualdade estrutural — o suficiente para JSON vindo do `jsonb`. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function walk(before: unknown, after: unknown, prefix: string, out: DiffEntry[]): void {
  if (sameValue(before, after)) return;

  // Criação (`before: null`) e remoção viram a lista de campos do lado que
  // existe, e não um "(raiz) mudou" que ninguém consegue ler.
  const left =
    isEmpty(before) && (isPlainObject(after) || Array.isArray(after))
      ? Array.isArray(after)
        ? []
        : {}
      : before;
  const right =
    isEmpty(after) && (isPlainObject(before) || Array.isArray(before))
      ? Array.isArray(before)
        ? []
        : {}
      : after;

  if (isPlainObject(left) && isPlainObject(right)) {
    for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
      walk(left[key], right[key], join(prefix, key), out);
    }
    return;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
      walk(left[index], right[index], `${prefix}[${index}]`, out);
    }
    return;
  }

  const kind: DiffKind = isEmpty(before) ? 'added' : isEmpty(after) ? 'removed' : 'changed';
  out.push({ path: prefix || '(raiz)', kind, before, after });
}

/**
 * Lista plana de mudanças, ordenada por caminho. Uma linha só de `after` (a
 * maioria: criar cargo, punir membro) vira uma lista de campos adicionados,
 * que é como o painel quer mostrar mesmo.
 */
export function diffJson(before: unknown, after: unknown): DiffEntry[] {
  const out: DiffEntry[] = [];
  walk(before, after, '', out);
  return out;
}

/** Valor de um lado do diff em texto curto — o que a célula mostra. */
export function formatDiffValue(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
