'use client';

import * as React from 'react';

import type { ManualMatchEvaluation } from '@goodbot/shared';

const plural = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

/**
 * §6.3 — a barra de seleção em massa, no lugar da busca: contagem, nota e
 * avisos calculados no navegador com a mesma função do bot. É prévia: o
 * diálogo de revisão mostra o que o bot calculou com dados frescos.
 */
export function SelectionBar({
  evaluation,
  nameOf,
  fieldLabel,
  onPropose,
  onClear,
}: {
  evaluation: Pick<ManualMatchEvaluation, 'userIds' | 'pairs' | 'score' | 'blocks' | 'warnings'>;
  nameOf: (userId: string) => string;
  fieldLabel: (key: string) => string;
  onPropose: () => void;
  onClear: () => void;
}) {
  const [pairsOpen, setPairsOpen] = React.useState(false);
  const count = evaluation.userIds.length;

  return (
    <div className="flex flex-col gap-3 border-2 border-base-300 bg-accent p-3 text-accent-content">
      <p className="text-sm font-bold uppercase tracking-wide">
        {plural(count, 'SELECIONADO', 'SELECIONADOS')} · NOTA {evaluation.score} ·{' '}
        {plural(evaluation.warnings.length, 'AVISO', 'AVISOS')} ·{' '}
        {plural(evaluation.blocks.length, 'BLOQUEIO', 'BLOQUEIOS')}
      </p>

      {evaluation.pairs.length > 0 ? (
        <>
          <button
            type="button"
            className="self-start text-xs font-bold uppercase tracking-wide underline lg:hidden"
            aria-expanded={pairsOpen}
            onClick={() => setPairsOpen((open) => !open)}
          >
            DUPLAS {pairsOpen ? '▴' : '▾'}
          </button>
          <ul
            className={
              pairsOpen
                ? 'flex flex-wrap gap-x-4 gap-y-1 text-xs uppercase'
                : 'hidden flex-wrap gap-x-4 gap-y-1 text-xs uppercase lg:flex'
            }
          >
            {evaluation.pairs.map((pair) => {
              const [a, b] = pair.userIds;
              const tags = [
                pair.hardConflicts.length > 0
                  ? `PRECISA BATER: ${pair.hardConflicts.map(fieldLabel).join(', ').toUpperCase()}`
                  : null,
                pair.commonCells === 0 ? '0 FAIXAS' : null,
                pair.cooldown ? 'PAUSA' : null,
              ].filter(Boolean);
              return (
                <li key={`${a}:${b}`}>
                  {nameOf(a)}+{nameOf(b)} {pair.score}
                  {tags.length > 0 ? ` ${tags.join(' ')}` : ''}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-goodchat-outline"
          disabled={count < 2}
          onClick={onPropose}
        >
          PROPOR AO GRUPO
        </button>
        <button type="button" className="btn-goodchat-outline" onClick={onClear}>
          LIMPAR
        </button>
      </div>
    </div>
  );
}
