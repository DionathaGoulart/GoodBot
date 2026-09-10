import { ScreenHeader } from '@/components/retro/screen-header';
import { ErrorState } from '@/components/retro/states';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { loadScheduledEvents } from '@/lib/events';

import { EventsScreen } from './events-screen';

export const metadata = { title: 'Eventos · Goodbot' };

/** §6.3 — criar e editar eventos agendados do Discord. */
export default async function EventsPage({ params }: PageProps<'/g/[guildId]/eventos'>) {
  const { guildId } = await params;
  const session = await requireGuildAccess(guildId);
  const { list, error } = await loadScheduledEvents(guildId);

  return (
    <>
      <ScreenHeader
        kicker="SERVIDOR"
        title="Eventos"
        meta="Evento fora do Discord precisa de local e de data de fim."
      />
      {list ? (
        <EventsScreen list={list} readOnly={!hasAccess(session.level, 'admin')} />
      ) : (
        <ErrorState description={error ?? 'O bot não respondeu.'} />
      )}
    </>
  );
}
