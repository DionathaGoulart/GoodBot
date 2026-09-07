import { diffJson, formatDiffValue, type DiffKind } from '@/lib/json-diff';

import { EmptyState } from './retro/states';

/** §2.3 — verde entra, vermelho sai, amarelo muda. */
const KIND_CLASS: Record<DiffKind, string> = {
  added: 'border-success text-success-text',
  removed: 'border-error text-error-text',
  changed: 'border-warning text-warning-text',
};

const KIND_LABEL: Record<DiffKind, string> = {
  added: '+ ADICIONADO',
  removed: '- REMOVIDO',
  changed: '~ ALTERADO',
};

/**
 * O `before`/`after` de uma linha de auditoria como uma lista de campos
 * (PRD §6.5). Um dump de JSON dos dois lados não é legível; o que interessa é
 * qual chave mudou e de quê para quê.
 */
export function JsonDiff({ before, after }: { before: unknown; after: unknown }) {
  const entries = diffJson(before, after);

  if (entries.length === 0) {
    return (
      <EmptyState
        title="SEM DIFERENÇA"
        description="Esta entrada não guardou um antes e depois comparáveis."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry) => (
        <li
          key={entry.path}
          className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 border-l-2 pl-3 ${KIND_CLASS[entry.kind]}`}
        >
          <span className="screen-meta">{KIND_LABEL[entry.kind]}</span>
          <code className="text-sm font-bold text-base-content">{entry.path}</code>
          {entry.kind !== 'added' ? (
            <code className="text-sm text-base-content opacity-60 line-through">
              {formatDiffValue(entry.before)}
            </code>
          ) : null}
          {entry.kind !== 'removed' ? (
            <code className="text-sm text-base-content">{formatDiffValue(entry.after)}</code>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
