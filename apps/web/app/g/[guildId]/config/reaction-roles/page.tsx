import { ScreenHeader } from '@/components/retro/screen-header';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { CONFIG_PAGES } from '@/lib/config-pages';
import { loadChannelNames } from '@/lib/discord';
import { loadGeneralPage, loadModuleConfig } from '@/lib/module-config';
import { loadPanels } from '@/lib/reaction-roles';

import { ReactionRolesConfigForm } from './form';
import { PanelsTable } from './panels';

export const metadata = { title: 'Reaction roles · Goodbot' };

export default async function ReactionRolesConfigPage({
  params,
}: PageProps<'/g/[guildId]/config/reaction-roles'>) {
  const { guildId } = await params;
  const session = await requireGuildAccess(guildId);
  const [{ config }, panels, general, channelNames] = await Promise.all([
    loadModuleConfig(guildId, 'reaction_roles'),
    loadPanels(guildId),
    loadGeneralPage(guildId),
    loadChannelNames(guildId),
  ]);
  const readOnly = !hasAccess(session.level, 'admin');

  return (
    <>
      <ScreenHeader
        kicker="CONFIGURAÇÃO"
        title={CONFIG_PAGES['reaction-roles'].title}
        meta={CONFIG_PAGES['reaction-roles'].description}
      />
      <PanelsTable
        panels={panels}
        channelNames={channelNames}
        embedColor={general.settings.embedColor}
        readOnly={readOnly}
      />
      <ReactionRolesConfigForm values={config} readOnly={readOnly} />
    </>
  );
}
