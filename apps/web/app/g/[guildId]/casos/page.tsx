import { Pager } from '@/components/data-table';
import { Panel } from '@/components/retro/panel';
import { ScreenHeader } from '@/components/retro/screen-header';
import { requireGuildAccess } from '@/lib/auth/require';
import { caseFiltersToQuery, parseCaseFilters } from '@/lib/case-filters';
import { loadCasesPage } from '@/lib/cases';

import { CaseFiltersBar } from './filters';
import { CasesTable } from './cases-table';

export const metadata = { title: 'Casos · Goodbot' };

/**
 * Casos (PRD §6.4). O filtro inteiro mora na URL: a página é compartilhável e
 * o export de CSV recebe exatamente os mesmos parâmetros.
 */
export default async function CasesPage({ params, searchParams }: PageProps<'/g/[guildId]/casos'>) {
  const { guildId } = await params;
  await requireGuildAccess(guildId);

  const filters = parseCaseFilters(await searchParams);
  const { rows, total, pageCount } = await loadCasesPage(guildId, filters);

  // O pager escreve o `page` dele; o resto do filtro vai junto sem ele.
  const query = caseFiltersToQuery({ ...filters, page: 1 });
  const basePath = `/g/${guildId}/casos`;

  return (
    <>
      <ScreenHeader
        kicker="MODERAÇÃO"
        title="Casos"
        meta="Todo caso registrado neste servidor, por comando, painel ou automod."
      />
      <Panel title="CASOS.LOG">
        {/* A `key` amarra o rascunho da barra à URL: voltar no histórico ou
            limpar o filtro remonta com os valores certos. */}
        <CaseFiltersBar key={query.toString()} basePath={basePath} filters={filters} />
        <CasesTable guildId={guildId} rows={rows} />
        <Pager
          basePath={basePath}
          query={query}
          page={filters.page}
          pageCount={pageCount}
          total={total}
        />
      </Panel>
    </>
  );
}
