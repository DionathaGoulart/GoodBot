// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Panel } from './panel';
import { StatTile } from './stat-tile';

describe('Panel', () => {
  it('mostra a barra de título quando recebe um nome de "arquivo"', () => {
    render(
      <Panel title="AUTOMOD.CFG">
        <p>conteúdo</p>
      </Panel>,
    );
    expect(screen.getByText('AUTOMOD.CFG')).toBeInTheDocument();
    expect(screen.getByText('conteúdo')).toBeInTheDocument();
  });

  // Regressão da Etapa 26: o apagado da barra é do *nome do arquivo*. Quando
  // era `opacity` na barra inteira, os botões de ação caíam junto para a
  // opacidade de um `:disabled` e pareciam desligados.
  it('apaga só o título, nunca as ações da barra', () => {
    const { container } = render(
      <Panel title="CASOS.LOG" actions={<button type="button">EXPORTAR</button>}>
        <p>conteúdo</p>
      </Panel>,
    );
    const bar = container.querySelector('.window-bar');
    expect(bar?.className).not.toMatch(/opacity/);
    expect(screen.getByText('CASOS.LOG')).toHaveClass('window-bar-title');
    expect(screen.getByRole('button', { name: 'EXPORTAR' }).closest('.window-bar-title')).toBeNull();
  });

  it('sem título não renderiza barra alguma', () => {
    const { container } = render(
      <Panel>
        <p>só corpo</p>
      </Panel>,
    );
    expect(container.querySelector('.window-bar')).toBeNull();
    expect(container.querySelector('.panel')).not.toBeNull();
  });
});

describe('StatTile', () => {
  it('usa ▲ para delta positivo e ▼ para negativo', () => {
    const { rerender } = render(<StatTile label="MEMBROS" value="1.204" delta={12.5} />);
    expect(screen.getByText(/▲ 12\.5%/)).toBeInTheDocument();

    rerender(<StatTile label="MEMBROS" value="1.204" delta={-3} />);
    expect(screen.getByText(/▼ 3\.0%/)).toBeInTheDocument();
  });

  it('omite o delta quando não há comparação', () => {
    render(<StatTile label="CASOS" value="—" />);
    expect(screen.queryByText(/[▲▼]/)).toBeNull();
    expect(screen.getByText('CASOS')).toBeInTheDocument();
  });
});
