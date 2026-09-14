// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ActivityHeatmap, HeatmapGrid } from './activity-heatmap';

const cellsOf = (container: HTMLElement) => container.querySelectorAll<HTMLElement>('div[title]');

describe('ActivityHeatmap', () => {
  it('continua sendo a grade de 7 dias por 24 horas, com a hora a cada 6', () => {
    const { container } = render(
      <ActivityHeatmap
        data={[
          { weekday: 6, hour: 21, count: 8 },
          { weekday: 1, hour: 9, count: 2 },
        ]}
      />,
    );

    expect(cellsOf(container)).toHaveLength(168);
    expect(screen.getByTitle('SÁB 21H · 8 MSGS').style.opacity).toBe('1');
    // Qualquer atividade acende pelo menos o primeiro degrau.
    expect(screen.getByTitle('SEG 09H · 2 MSGS').style.opacity).toBe('0.25');
    expect(screen.getByTitle('DOM 00H · 0 MSGS').style.opacity).toBe('0.06');
    for (const hour of ['0', '6', '12', '18']) expect(screen.getByText(hour)).toBeInTheDocument();
    expect(screen.getByText('MAIS · PICO 8')).toBeInTheDocument();
  });
});

describe('HeatmapGrid', () => {
  const DAYS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
  const BLOCKS = ['MANHÃ', 'TARDE', 'NOITE', 'MADRUGADA'];

  it('desenha 7 x 4 com as colunas de quem chama, tooltip e legenda', () => {
    const { container } = render(
      <HeatmapGrid
        rows={DAYS}
        columns={BLOCKS}
        value={(row, column) => (row === 6 && column === 2 ? 5 : 0)}
        tooltip={(row, column, count) =>
          `${DAYS[row] ?? ''} ${BLOCKS[column] ?? ''} · ${String(count)}`
        }
        legendUnit="JOGADORES"
      />,
    );

    expect(cellsOf(container)).toHaveLength(28);
    expect(screen.getByTitle('SÁB NOITE · 5').style.opacity).toBe('1');
    expect(screen.getByText('MAIS · PICO 5 JOGADORES')).toBeInTheDocument();
    for (const label of BLOCKS) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByTitle('DOM MANHÃ · 0').parentElement?.style.gridTemplateColumns).toBe(
      'repeat(4, minmax(0, 1fr))',
    );
  });

  it('esconde a legenda quando pedido', () => {
    render(
      <HeatmapGrid rows={DAYS} columns={BLOCKS} value={() => 1} tooltip={() => 'x'} legend={false} />,
    );

    expect(screen.queryByText('MENOS')).not.toBeInTheDocument();
  });
});
