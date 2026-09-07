import Link from 'next/link';

import { Panel } from '@/components/retro/panel';
import { EmptyState } from '@/components/retro/states';
import { Tag } from '@/components/retro/tag';
import { AUDIT_SOURCE_LABEL, AUDIT_SOURCE_TONES, auditTargetHref } from '@/lib/audit-sources';
import { CASE_TONES } from '@/lib/case-tones';
import type { RecentAudit, RecentCase } from '@/lib/stats';

function when(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function MoreLink({ href }: { href: string }) {
  return (
    <Link href={href} className="icon-btn">
      VER TUDO
    </Link>
  );
}

/** Últimos 10 casos (PRD §6.1); a listagem completa é a página de casos. */
export function RecentCases({ guildId, cases }: { guildId: string; cases: RecentCase[] }) {
  return (
    <Panel title="CASOS.LOG" actions={<MoreLink href={`/g/${guildId}/casos`} />}>
      {cases.length === 0 ? (
        <EmptyState
          title="NENHUM CASO"
          description="Nenhuma ação de moderação foi registrada ainda neste servidor."
        />
      ) : (
        <ul className="flex flex-col divide-y-2 divide-base-300">
          {cases.map((item) => (
            <li key={item.caseNumber}>
              <Link
                href={`/g/${guildId}/casos/${item.caseNumber}`}
                className="flex flex-wrap items-center gap-3 py-2 hover:bg-base-300/30"
              >
                <span className="screen-meta w-14 shrink-0">#{item.caseNumber}</span>
                <Tag tone={CASE_TONES[item.type] ?? 'muted'}>{item.type}</Tag>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {item.targetTag}
                  <span className="opacity-60"> — {item.reason}</span>
                </span>
                <span className="screen-meta shrink-0">{when(item.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * "Últimas ações" (PRD §6.1, Etapa 22): as 10 mais recentes de **qualquer**
 * origem — painel, comando, automod, evento ou job. Cada linha aponta para o
 * alvo quando ele tem página; sem alvo navegável, cai na auditoria filtrada
 * por aquela ação.
 */
export function RecentAuditLog({ guildId, entries }: { guildId: string; entries: RecentAudit[] }) {
  return (
    <Panel title="ULTIMAS_ACOES.LOG" actions={<MoreLink href={`/g/${guildId}/auditoria`} />}>
      {entries.length === 0 ? (
        <EmptyState
          title="NADA AQUI"
          description="Nada aconteceu ainda. Toda ação — sua ou do bot — vira uma linha nesta lista."
        />
      ) : (
        <ul className="flex flex-col divide-y-2 divide-base-300">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Link
                href={
                  auditTargetHref(guildId, entry) ??
                  `/g/${guildId}/auditoria?action=${encodeURIComponent(entry.action)}`
                }
                className="flex flex-wrap items-center gap-3 py-2 hover:bg-base-300/30"
              >
                <Tag tone={AUDIT_SOURCE_TONES[entry.source]}>
                  {AUDIT_SOURCE_LABEL[entry.source]}
                </Tag>
                <span className="screen-meta shrink-0">{entry.action}</span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {entry.actorTag}
                  {entry.reason ? <span className="opacity-60"> — {entry.reason}</span> : null}
                </span>
                <span className="screen-meta shrink-0">{when(entry.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
