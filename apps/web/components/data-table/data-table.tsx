'use client';

import * as React from 'react';
import {
  columnFilteringFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
  useTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { cn } from 'cn';

import { EmptyState, ErrorState } from '@/components/retro/states';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * §6.3 — as únicas capacidades que o painel usa. Em v9 cada feature entra
 * explicitamente; registrar o mínimo mantém o bundle do dashboard pequeno.
 */
export const tableFeaturesUsed = tableFeatures({
  // `globalFilteringFeature` é construído em cima do filtro por coluna, então
  // os dois entram juntos mesmo o painel só usando a busca global.
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  filterFns: { includesString: filterFn_includesString },
  sortFns: { alphanumeric: sortFn_alphanumeric },
});

export type TableFeaturesUsed = typeof tableFeaturesUsed;
/** O `ColumnDef` que as telas escrevem: as features já vêm amarradas. */
export type PanelColumnDef<T extends Record<string, unknown>> = ColumnDef<
  TableFeaturesUsed,
  T,
  unknown
>;

/** §8 — a tabela em loading mostra 5 linhas na altura real, sem shimmer. */
function TableSkeleton({ columns }: { columns: number }) {
  return (
    <TableBody>
      {Array.from({ length: 5 }, (_, row) => (
        <TableRow key={row}>
          {Array.from({ length: columns }, (_, cell) => (
            <TableCell key={cell}>
              <Skeleton className="h-5 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );
}

export interface DataTableProps<T extends Record<string, unknown>> {
  columns: PanelColumnDef<T>[];
  data: T[];
  /** Placeholder da busca; ausente = sem campo de busca. */
  searchPlaceholder?: string;
  /** Filtros e botões da barra de ferramentas (§6.3). */
  toolbar?: React.ReactNode;
  /** Texto do estado vazio (§8) e o CTA opcional ao lado. */
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  /** `true` mantém as linhas e escurece o corpo (§8, refetch). */
  refetching?: boolean;
  loading?: boolean;
  error?: string | null;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  className?: string;
}

/**
 * §6.3 — a tabela do painel: TanStack Table por trás do `table` do shadcn, com
 * busca, ordenação, paginação e os estados do §8 num lugar só. As telas passam
 * colunas e dados; nenhum estado de tabela vaza para elas.
 */
export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  searchPlaceholder,
  toolbar,
  emptyDescription = 'Nada para mostrar por aqui.',
  emptyAction,
  refetching = false,
  loading = false,
  error = null,
  onRowClick,
  pageSize = 20,
  className,
}: DataTableProps<T>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState('');
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize });

  const table = useTable({
    features: tableFeaturesUsed,
    data,
    columns,
    state: { sorting, globalFilter, pagination },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    globalFilterFn: 'includesString',
  });

  if (error) return <ErrorState description={error} />;

  const rows = table.getRowModel().rows;
  const columnCount = table.getAllLeafColumns().length;
  const pageCount = Math.max(1, table.getPageCount());
  const total = table.getFilteredRowModel().rows.length;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {searchPlaceholder || toolbar ? (
        <div className="flex flex-wrap items-center gap-2">
          {searchPlaceholder ? (
            <Input
              className="max-w-xs"
              placeholder={searchPlaceholder}
              value={globalFilter}
              onChange={(event) => setGlobalFilter(event.target.value)}
            />
          ) : null}
          {toolbar ? <div className="ml-auto flex flex-wrap gap-2">{toolbar}</div> : null}
        </div>
      ) : null}

      {!loading && rows.length === 0 ? (
        <EmptyState description={emptyDescription} action={emptyAction} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id}>
                  {group.headers.map((header) => {
                    const direction = header.column.getIsSorted();
                    return (
                      <TableHead key={header.id}>
                        {header.isPlaceholder ? null : header.column.getCanSort() ? (
                          <button
                            type="button"
                            className="flex items-center gap-1 transition-colors hover:text-accent-text"
                            onClick={() => header.column.toggleSorting()}
                          >
                            <table.FlexRender header={header} />
                            <span aria-hidden className="text-muted-text">
                              {direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : ''}
                            </span>
                          </button>
                        ) : (
                          <table.FlexRender header={header} />
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>

            {loading ? (
              <TableSkeleton columns={columnCount} />
            ) : (
              <TableBody aria-busy={refetching || undefined}>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className={onRowClick ? 'cursor-pointer' : undefined}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  >
                    {row.getAllCells().map((cell) => (
                      <TableCell key={cell.id}>
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            )}
          </Table>
        </div>
      )}

      {!loading && rows.length > 0 && pageCount > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className="screen-meta">
            PÁGINA {pagination.pageIndex + 1}/{pageCount} · {total} REGISTRO
            {total === 1 ? '' : 'S'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="icon-btn"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              {'< ANTERIOR'}
            </button>
            <button
              type="button"
              className="icon-btn"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              {'PRÓXIMA >'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
