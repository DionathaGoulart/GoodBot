import { ScreenHeader } from '@/components/retro/screen-header';
import { ErrorState } from '@/components/retro/states';
import { requireGuildAccess } from '@/lib/auth/require';
import { loadRoleNames } from '@/lib/discord';
import { searchMembers } from '@/lib/members';

import { MembersTable } from './members-table';

export const metadata = { title: 'Membros · Goodbot' };

export default async function MembersPage({
  params,
  searchParams,
}: PageProps<'/g/[guildId]/membros'>) {
  const { guildId } = await params;
  await requireGuildAccess(guildId);

  // A busca é do bot, não da tabela: só ele acha um ID que não está no cache.
  const { q } = await searchParams;
  const query = typeof q === 'string' ? q : '';

  const [{ members, error }, roleNames] = await Promise.all([
    searchMembers(guildId, query),
    loadRoleNames(guildId),
  ]);

  return (
    <>
      <ScreenHeader
        kicker="SERVIDOR"
        title="Membros"
        meta="Busque por nome, tag ou ID. Abrir o membro mostra casos, cargos e punições."
      />
      {error ? (
        <ErrorState description={error} />
      ) : (
        <MembersTable guildId={guildId} members={members} roleNames={roleNames} query={query} />
      )}
    </>
  );
}
