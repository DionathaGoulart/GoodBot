import { ScreenHeader } from '@/components/retro/screen-header';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { CONFIG_PAGES } from '@/lib/config-pages';
import { loadModuleConfig } from '@/lib/module-config';

import { AutoroleConfigForm } from './form';

export const metadata = { title: 'Autorole · Goodbot' };

export default async function AutoroleConfigPage({
  params,
}: PageProps<'/g/[guildId]/config/autorole'>) {
  const { guildId } = await params;
  const session = await requireGuildAccess(guildId);
  const { config } = await loadModuleConfig(guildId, 'autorole');

  return (
    <>
      <ScreenHeader
        kicker="CONFIGURAÇÃO"
        title={CONFIG_PAGES.autorole.title}
        meta={CONFIG_PAGES.autorole.description}
      />
      <AutoroleConfigForm values={config} readOnly={!hasAccess(session.level, 'admin')} />
    </>
  );
}
