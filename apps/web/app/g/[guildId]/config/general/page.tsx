import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { CONFIG_PAGES } from '@/lib/config-pages';
import { loadGeneralPage } from '@/lib/module-config';
import { ScreenHeader } from '@/components/retro/screen-header';

import { GeneralConfigForm } from './form';

export const metadata = { title: 'Geral · CoBot' };

export default async function GeneralConfigPage({
  params,
}: PageProps<'/g/[guildId]/config/general'>) {
  const { guildId } = await params;
  const session = await requireGuildAccess(guildId);
  const values = await loadGeneralPage(guildId);

  return (
    <>
      <ScreenHeader
        kicker="CONFIGURAÇÃO"
        title={CONFIG_PAGES.general.title}
        meta={CONFIG_PAGES.general.description}
      />
      <GeneralConfigForm values={values} readOnly={!hasAccess(session.level, 'admin')} />
    </>
  );
}
