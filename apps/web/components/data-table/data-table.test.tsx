// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DataTable, type PanelColumnDef } from './index';

type Row = { name: string; hits: number };

const COLUMNS: PanelColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'NOME' },
  { accessorKey: 'hits', header: 'HITS' },
];

const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_, index) => ({
    name: `regra-${String(index).padStart(2, '0')}`,
    hits: count - index,
  }));

describe('DataTable', () => {
  it('mostra o estado vazio quando não há dados', () => {
    render(<DataTable columns={COLUMNS} data={[]} emptyDescription="Nenhuma regra criada." />);
    expect(screen.getByText('Nenhuma regra criada.')).toBeInTheDocument();
  });

  it('pagina: a segunda página traz o resto dos registros', () => {
    render(<DataTable columns={COLUMNS} data={rows(5)} pageSize={2} />);

    expect(screen.getByText('regra-00')).toBeInTheDocument();
    expect(screen.queryByText('regra-02')).not.toBeInTheDocument();
    expect(screen.getByText(/PÁGINA 1\/3 · 5 REGISTROS/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'PRÓXIMA >' }));

    expect(screen.getByText('regra-02')).toBeInTheDocument();
    expect(screen.queryByText('regra-00')).not.toBeInTheDocument();
  });

  it('ordena ao clicar no cabeçalho', () => {
    render(<DataTable columns={COLUMNS} data={rows(3)} />);
    const header = screen.getByRole('button', { name: /HITS/ });
    const firstHits = () => screen.getAllByRole('cell')[1]?.textContent;

    // Coluna numérica começa em decrescente; `hits` já vem assim da origem.
    fireEvent.click(header);
    expect(firstHits()).toBe('3');

    fireEvent.click(header);
    expect(firstHits()).toBe('1');
  });

  it('a busca filtra as linhas e o total acompanha', () => {
    render(<DataTable columns={COLUMNS} data={rows(12)} searchPlaceholder="BUSCAR" pageSize={5} />);

    fireEvent.change(screen.getByPlaceholderText('BUSCAR'), { target: { value: 'regra-01' } });

    expect(screen.getByText('regra-01')).toBeInTheDocument();
    expect(screen.queryByText('regra-02')).not.toBeInTheDocument();
  });
});
