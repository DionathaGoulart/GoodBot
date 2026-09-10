'use client';

import { approveGuildAction } from '@/app/actions/admin';
import { AvatarSq } from '@/components/retro/avatar-sq';
import { EmptyState } from '@/components/retro/states';

import { relativeTime } from '../status-tag';
import { useAdminAction } from '../use-admin-action';

import type { AdminGuildRow } from '@/lib/admin';

/**
 * A blocklist.
 *
 * Desbloquear é aprovar: não existe estado "bloqueado, mas tudo bem" — ou o
 * bot atende, ou não. Por isso o único botão aqui é o de aprovar, e não um
 * "desbloquear" que deixaria a linha em `pending` esperando um segundo clique.
 */
export function Blocklist({ rows }: { rows: readonly AdminGuildRow[] }) {
  const { busy, run } = useAdminAction();

  if (rows.length === 0) {
    return <EmptyState title="NINGUÉM BLOQUEADO" description="A blocklist está vazia." />;
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li
          key={row.guildId}
          className="flex flex-wrap items-center gap-3 border-2 border-base-300 bg-base-100 px-3 py-2"
        >
          <AvatarSq src={row.live?.iconUrl} name={row.live?.name ?? row.guildId} size={24} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-bold">{row.live?.name ?? row.guildId}</span>
            <span className="screen-meta select-all">{row.guildId}</span>
            <span className="screen-meta block">
              BLOQUEADO {relativeTime(row.leftAt ?? row.invitedAt)}
              {row.note ? ` · ${row.note}` : ''}
            </span>
          </span>
          <button
            type="button"
            className="icon-btn"
            disabled={busy !== null}
            onClick={() => {
              void run(row.guildId, approveGuildAction, { guildId: row.guildId });
            }}
          >
            {busy === row.guildId ? 'APROVANDO_' : 'APROVAR'}
          </button>
        </li>
      ))}
    </ul>
  );
}
