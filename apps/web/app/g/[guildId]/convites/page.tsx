import { ScreenHeader } from '@/components/retro/screen-header';
import { ErrorState } from '@/components/retro/states';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { loadInvites } from '@/lib/invites';

import { InvitesScreen } from './invites-screen';

export const metadata = { title: 'Convites · Goodbot' };

/**
 * §6.3 — criar e revogar convites. `mod` vê a lista (é ela que explica de onde
 * veio quem entrou); só `admin` cria e revoga, e quem barra de verdade é a
 * server action.
 */
export default async function InvitesPage({ params }: PageProps<'/g/[guildId]/convites'>) {
  const { guildId } = await params;
  const session = await requireGuildAccess(guildId);
  const { list, error } = await loadInvites(guildId);

  return (
    <>
      <ScreenHeader
        kicker="SERVIDOR"
        title="Convites"
        meta="Usos e validade vêm do Discord ao vivo. Revogar não expulsa quem já entrou."
      />
      {list ? (
        <InvitesScreen list={list} readOnly={!hasAccess(session.level, 'admin')} />
      ) : (
        <ErrorState description={error ?? 'O bot não respondeu.'} />
      )}
    </>
  );
}
