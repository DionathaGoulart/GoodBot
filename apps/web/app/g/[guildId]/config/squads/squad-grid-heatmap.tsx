import { SQUAD_BLOCKS, type SquadBlockConfig } from '@goodbot/shared';

import { HeatmapGrid } from '@/components/charts/activity-heatmap';
import { SQUAD_DAY_SHORT } from '@/lib/squad-labels';

/**
 * A grade semanal dos squads (7 dias × 4 faixas) como heatmap. `count` mostra
 * quantos jogadores marcaram cada célula; `mask` é a grade de uma pessoa só,
 * de zeros e uns, sem legenda.
 */
export function SquadGridHeatmap({
  grid,
  blocks,
  mode = 'count',
}: {
  /** 28 posições, índice = bit da célula. */
  grid: readonly number[];
  blocks: readonly SquadBlockConfig[];
  mode?: 'count' | 'mask';
}) {
  const columns = blocks.map((block) => block.label.toUpperCase());
  const night = columns[SQUAD_BLOCKS.indexOf('night')] ?? 'MADRUGADA';

  return (
    <div className="flex flex-col gap-3">
      <HeatmapGrid
        rows={SQUAD_DAY_SHORT}
        columns={columns}
        value={(day, block) => grid[day * SQUAD_BLOCKS.length + block] ?? 0}
        tooltip={(day, block, count) => {
          const cell = `${SQUAD_DAY_SHORT[day] ?? ''} ${columns[block] ?? ''}`;
          if (mode === 'mask') return `${cell} · ${count > 0 ? 'MARCADO' : 'LIVRE'}`;
          return `${cell} · ${String(count)} ${count === 1 ? 'JOGADOR' : 'JOGADORES'}`;
        }}
        legendUnit="JOGADORES"
        legend={mode === 'count'}
      />
      <p className="screen-meta">A {night} DE SÁB É A NOITE DE SEX PARA SÁB</p>
    </div>
  );
}
