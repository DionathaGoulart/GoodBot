import { ScreenHeader } from '@/components/retro/screen-header';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { CONFIG_PAGES } from '@/lib/config-pages';
import { loadLogsPage } from '@/lib/module-config';

import { LogsConfigForm } from './form';

export const metadata = { title: 'Logs · CoBot' };

export default async function LogsConfigPage({
  params,
}: PageProps<'/g/[guildId]/config/logs'>) {
  const { guildId } = await params;
  const session = await requireGuildAccess(guildId);
  const values = await loadLogsPage(guildId);

  return (
    <>
      <ScreenHeader
        kicker="CONFIGURAÇÃO"
        title={CONFIG_PAGES.logs.title}
        meta={CONFIG_PAGES.logs.description}
      />
      <LogsConfigForm values={values} readOnly={!hasAccess(session.level, 'admin')} />
    </>
  );
}
