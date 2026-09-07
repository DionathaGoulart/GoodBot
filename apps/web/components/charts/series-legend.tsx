'use client';

import { useState } from 'react';

import { cn } from 'cn';

export interface Series {
  key: string;
  label: string;
  color: string;
}

/**
 * §6.7 — a legenda é feita de `tag`s clicáveis que ligam e desligam a série.
 * O hook guarda o que está escondido; o gráfico decide o que fazer com isso.
 */
export function useSeriesToggle(series: readonly Series[]) {
  const [hidden, setHidden] = useState<readonly string[]>([]);

  function toggle(key: string) {
    setHidden((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  return {
    hidden,
    isHidden: (key: string) => hidden.includes(key),
    // Nunca deixa apagar a última série acesa: um gráfico vazio por clique
    // parece bug, não escolha.
    legend: (
      <SeriesLegend
        series={series}
        hidden={hidden}
        onToggle={(key) => {
          if (hidden.length === series.length - 1 && !hidden.includes(key)) return;
          toggle(key);
        }}
      />
    ),
  };
}

export function SeriesLegend({
  series,
  hidden,
  onToggle,
}: {
  series: readonly Series[];
  hidden: readonly string[];
  onToggle: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {series.map((item) => {
        const off = hidden.includes(item.key);
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={!off}
            onClick={() => onToggle(item.key)}
            className={cn('tag tag-muted', off && 'line-through')}
          >
            <span
              aria-hidden
              className="size-2 border-2 border-base-300"
              style={{ backgroundColor: off ? 'transparent' : item.color }}
            />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
