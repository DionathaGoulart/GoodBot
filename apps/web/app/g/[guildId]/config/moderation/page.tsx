import { ScreenHeader } from '@/components/retro/screen-header';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { CONFIG_PAGES } from '@/lib/config-pages';
import { loadModuleConfig } from '@/lib/module-config';

import { ModerationConfigForm } from './form';

export const metadata = { title: 'Moderação · Goodbot' };

export default async function ModerationConfigPage({
  params,
}: PageProps<'/g/[guildId]/config/moderation'>) {
  const { guildId } = await params;
  const session = await requireGuildAccess(guildId);
  const { config } = await loadModuleConfig(guildId, 'moderation');

  return (
    <>
      <ScreenHeader
        kicker="CONFIGURAÇÃO"
        title={CONFIG_PAGES.moderation.title}
        meta={CONFIG_PAGES.moderation.description}
      />
      <ModerationConfigForm values={config} readOnly={!hasAccess(session.level, 'admin')} />
    </>
  );
}
