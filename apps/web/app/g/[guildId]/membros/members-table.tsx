'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { AvatarSq } from '@/components/retro/avatar-sq';
import { DataTable, type PanelColumnDef } from '@/components/data-table';
import { Panel } from '@/components/retro/panel';
import { Tag } from '@/components/retro/tag';
import { Input } from '@/components/ui/input';

import type { GuildMemberSummary } from '@cobot/shared';

type MemberRow = GuildMemberSummary & Record<string, unknown>;

/** `<time>` em micro-texto com o ISO completo no title (§6.3). */
function DateCell({ value }: { value: string | null }) {
  if (!value) return <span className="screen-meta">—</span>;
  return (
    <time dateTime={value} title={value} className="screen-meta">
      {new Date(value).toLocaleDateString('pt-BR')}
    </time>
  );
}

export function MembersTable({
  guildId,
  members,
  roleNames,
  query,
}: {
  guildId: string;
  members: GuildMemberSummary[];
  /** ID → `@nome`; vem do bot no server component. */
  roleNames: Record<string, string>;
  query: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [term, setTerm] = React.useState(query);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const next = new URLSearchParams(searchParams.toString());
    if (term.trim()) next.set('q', term.trim());
    else next.delete('q');
    router.push(`/g/${guildId}/membros?${next.toString()}`);
  };

  const columns = React.useMemo<PanelColumnDef<MemberRow>[]>(
    () => [
      {
        accessorKey: 'displayName',
        header: 'MEMBRO',
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <AvatarSq src={row.original.avatarUrl} name={row.original.displayName} size={24} />
            <span className="font-bold">{row.original.displayName}</span>
            <span className="opacity-60">{row.original.username}</span>
            {row.original.bot ? <Tag tone="muted">BOT</Tag> : null}
          </span>
        ),
      },
      {
        accessorKey: 'id',
        header: 'ID',
        cell: ({ row }) => <span className="screen-meta select-all">{row.original.id}</span>,
      },
      {
        id: 'roles',
        header: 'CARGOS',
        enableSorting: false,
        cell: ({ row }) => {
          const names = row.original.roleIds
            .map((roleId) => roleNames[roleId])
            .filter((name): name is string => Boolean(name));
          if (names.length === 0) return <span className="screen-meta">—</span>;
          return (
            <span className="flex flex-wrap gap-1.5">
              {names.slice(0, 3).map((name) => (
                <Tag key={name} tone="muted">
                  {name}
                </Tag>
              ))}
              {names.length > 3 ? <Tag tone="muted">+{names.length - 3}</Tag> : null}
            </span>
          );
        },
      },
      {
        accessorKey: 'joinedAt',
        header: 'ENTROU',
        cell: ({ row }) => <DateCell value={row.original.joinedAt} />,
      },
    ],
    [roleNames],
  );

  return (
    <Panel title="MEMBROS.LST">
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <Input
          className="max-w-xs"
          value={term}
          placeholder="NOME, TAG OU ID"
          onChange={(event) => setTerm(event.target.value)}
        />
        <button type="submit" className="icon-btn">
          BUSCAR
        </button>
      </form>

      <DataTable
        columns={columns}
        data={members as MemberRow[]}
        emptyDescription={
          query
            ? 'Nenhum membro com esse nome ou ID.'
            : 'Nenhum membro no cache do bot. Tente buscar por um ID.'
        }
        onRowClick={(row) => router.push(`/g/${guildId}/membros/${row.id}`)}
      />
    </Panel>
  );
}
