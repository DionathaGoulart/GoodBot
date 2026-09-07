'use client';

import * as React from 'react';
import Link from 'next/link';

import { DataTable, type PanelColumnDef } from '@/components/data-table';
import { Panel } from '@/components/retro/panel';
import { Tag } from '@/components/retro/tag';
import { CASE_TONES } from '@/lib/case-tones';

import type { MemberCaseRow } from '@/lib/members';

/** Os casos do membro; o histórico completo com filtros vive em `/casos`. */
export function MemberCases({
  rows,
  total,
  limit,
  guildId,
}: {
  rows: MemberCaseRow[];
  total: number;
  limit: number;
  guildId: string;
}) {
  const columns = React.useMemo<PanelColumnDef<MemberCaseRow>[]>(
    () => [
      {
        accessorKey: 'caseNumber',
        header: 'CASO',
        cell: ({ row }) => (
          <span className="screen-meta select-all">#{row.original.caseNumber}</span>
        ),
      },
      {
        accessorKey: 'type',
        header: 'AÇÃO',
        cell: ({ row }) => (
          <Tag tone={CASE_TONES[row.original.type] ?? 'muted'}>{row.original.type}</Tag>
        ),
      },
      { accessorKey: 'actorTag', header: 'MODERADOR' },
      {
        accessorKey: 'reason',
        header: 'MOTIVO',
        cell: ({ row }) => <span className="opacity-80">{row.original.reason ?? '—'}</span>,
      },
      {
        accessorKey: 'source',
        header: 'ORIGEM',
        cell: ({ row }) => <Tag tone="muted">{row.original.source}</Tag>,
      },
      {
        accessorKey: 'createdAt',
        header: 'QUANDO',
        cell: ({ row }) => (
          <time
            dateTime={row.original.createdAt}
            title={row.original.createdAt}
            className="screen-meta"
          >
            {new Date(row.original.createdAt).toLocaleString('pt-BR')}
          </time>
        ),
      },
    ],
    [],
  );

  return (
    <Panel
      title="CASOS.LOG"
      actions={
        total > limit ? (
          <Link href={`/g/${guildId}/casos`} className="icon-btn">
            VER TODOS ({total})
          </Link>
        ) : null
      }
    >
      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="BUSCAR NO HISTÓRICO"
        emptyDescription="Este membro nunca foi punido nem anotado."
      />
    </Panel>
  );
}
