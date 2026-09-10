import { ScreenHeader } from '@/components/retro/screen-header';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { CONFIG_PAGES } from '@/lib/config-pages';
import { loadChannelNames, loadRoleNames } from '@/lib/discord';
import { loadGeneralPage, loadModuleConfig } from '@/lib/module-config';
import { loadTicketPanels, loadTickets, loadTicketTypes } from '@/lib/tickets';

import { TicketsConfigForm } from './form';
import { TicketsTabs } from './tabs';

export const metadata = { title: 'Tickets · Goodbot' };

export default async function TicketsConfigPage({
  params,
}: PageProps<'/g/[guildId]/config/tickets'>) {
  const { guildId } = await params;
  const session = await requireGuildAccess(guildId);
  const [{ config }, types, panels, tickets, general, channelNames, roleNames] = await Promise.all([
    loadModuleConfig(guildId, 'tickets'),
    loadTicketTypes(guildId),
    loadTicketPanels(guildId),
    loadTickets(guildId),
    loadGeneralPage(guildId),
    loadChannelNames(guildId),
    loadRoleNames(guildId),
  ]);
  const readOnly = !hasAccess(session.level, 'admin');

  return (
    <>
      <ScreenHeader
        kicker="CONFIGURAÇÃO"
        title={CONFIG_PAGES.tickets.title}
        meta={CONFIG_PAGES.tickets.description}
      />
      <TicketsTabs
        types={types}
        panels={panels}
        tickets={tickets}
        channelNames={channelNames}
        roleNames={roleNames}
        embedColor={general.settings.embedColor}
        readOnly={readOnly}
        configSlot={<TicketsConfigForm values={config} readOnly={readOnly} />}
      />
    </>
  );
}
