import { Pager } from '@/components/data-table';
import { Panel } from '@/components/retro/panel';
import { ScreenHeader } from '@/components/retro/screen-header';
import { loadAuditPage } from '@/lib/audit';
import { requireGuildAccess } from '@/lib/auth/require';
import { auditFiltersToQuery, parseAuditFilters } from '@/lib/case-filters';

import { AuditTable } from './audit-table';

export const metadata = { title: 'Auditoria · CoBot' };

/**
 * Auditoria do painel (PRD §6.5). Tabela imutável: toda mutação feita por aqui
 * deixou uma linha, e a linha abre no diff do que mudou.
 */
export default async function AuditPage({
  params,
  searchParams,
}: PageProps<'/g/[guildId]/auditoria'>) {
  const { guildId } = await params;
  await requireGuildAccess(guildId, 'admin');

  const filters = parseAuditFilters(await searchParams);
  const { rows, total, pageCount, actions } = await loadAuditPage(guildId, filters);

  const basePath = `/g/${guildId}/auditoria`;

  return (
    <>
      <ScreenHeader
        kicker="SERVIDOR"
        title="Auditoria"
        meta="Tudo que aconteceu no servidor — pelo painel, por comando, pelo automod ou sozinho — com quem pediu e por quê. Nada aqui pode ser editado ou apagado."
      />
      <Panel title="AUDITORIA.LOG">
        <AuditTable
          guildId={guildId}
          basePath={basePath}
          filters={filters}
          rows={rows}
          actions={actions}
        />
        <Pager
          basePath={basePath}
          query={auditFiltersToQuery({ ...filters, page: 1 })}
          page={filters.page}
          pageCount={pageCount}
          total={total}
        />
      </Panel>
    </>
  );
}
