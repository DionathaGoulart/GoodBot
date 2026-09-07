'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { DataTable, type PanelColumnDef } from '@/components/data-table';
import { Tag } from '@/components/retro/tag';
import { CASE_TONES } from '@/lib/case-tones';
import { PAGE_SIZE } from '@/lib/case-filters';

import type { CaseRow } from '@/lib/cases';

function DateCell({ value }: { value: string }) {
  return (
    <time dateTime={value} title={value} className="screen-meta">
      {new Date(value).toLocaleString('pt-BR')}
    </time>
  );
}

/**
 * §6.3 — a tabela de casos. Filtro, ordenação e paginação já vieram prontos do
 * servidor: aqui a `DataTable` só pinta a página atual, sem paginar de novo.
 */
export function CasesTable({ guildId, rows }: { guildId: string; rows: CaseRow[] }) {
  const router = useRouter();

  const columns = React.useMemo<PanelColumnDef<CaseRow>[]>(
    () => [
      {
        accessorKey: 'caseNumber',
        header: 'CASO',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="screen-meta select-all">#{row.original.caseNumber}</span>
        ),
      },
      {
        accessorKey: 'type',
        header: 'AÇÃO',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5">
            <Tag tone={CASE_TONES[row.original.type] ?? 'muted'}>{row.original.type}</Tag>
            {row.original.deletedAt ? <Tag tone="muted">APAGADO</Tag> : null}
          </span>
        ),
      },
      {
        accessorKey: 'targetTag',
        header: 'ALVO',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="font-bold">{row.original.targetTag}</span>
            <span className="screen-meta select-all">{row.original.targetId}</span>
          </span>
        ),
      },
      { accessorKey: 'actorTag', header: 'MODERADOR', enableSorting: false },
      {
        accessorKey: 'reason',
        header: 'MOTIVO',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5">
            <span className="opacity-80">{row.original.reason}</span>
            {row.original.editedAt ? <Tag tone="muted">EDITADO</Tag> : null}
          </span>
        ),
      },
      {
        accessorKey: 'source',
        header: 'ORIGEM',
        enableSorting: false,
        cell: ({ row }) => <Tag tone="muted">{row.original.source}</Tag>,
      },
      {
        accessorKey: 'createdAt',
        header: 'QUANDO',
        enableSorting: false,
        cell: ({ row }) => <DateCell value={row.original.createdAt} />,
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      pageSize={PAGE_SIZE}
      emptyDescription="Nenhum caso com esses filtros. Tente afrouxar o período ou o tipo."
      onRowClick={(row) => router.push(`/g/${guildId}/casos/${row.caseNumber}`)}
    />
  );
}
