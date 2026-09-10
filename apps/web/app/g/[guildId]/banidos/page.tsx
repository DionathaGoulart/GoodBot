import { ScreenHeader } from '@/components/retro/screen-header';
import { ErrorState } from '@/components/retro/states';
import { requireGuildAccess } from '@/lib/auth/require';
import { loadBans } from '@/lib/guild';

import { BansTable } from './bans-table';

export const metadata = { title: 'Banidos · Goodbot' };

export default async function BansPage({
  params,
  searchParams,
}: PageProps<'/g/[guildId]/banidos'>) {
  const { guildId } = await params;
  const { q } = await searchParams;
  await requireGuildAccess(guildId);

  const query = typeof q === 'string' ? q : '';
  const { page, error } = await loadBans(guildId, { q: query });

  return (
    <>
      <ScreenHeader
        kicker="SERVIDOR"
        title="Banidos"
        meta="Busca por ID, nome ou motivo. Desbanir cria caso e escreve no mod-log."
      />
      {page ? (
        <BansTable guildId={guildId} page={page} query={query} />
      ) : (
        <ErrorState description={error ?? 'O bot não respondeu.'} />
      )}
    </>
  );
}
