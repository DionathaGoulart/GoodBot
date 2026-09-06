import { ScreenHeader } from '@/components/retro/screen-header';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { CONFIG_PAGES } from '@/lib/config-pages';
import { loadGeneralPage, loadModuleConfig } from '@/lib/module-config';

import { WelcomeConfigForm } from './form';

export const metadata = { title: 'Boas-vindas · CoBot' };

export default async function WelcomeConfigPage({
  params,
}: PageProps<'/g/[guildId]/config/welcome'>) {
  const { guildId } = await params;
  const session = await requireGuildAccess(guildId);
  // A cor do embed vem das preferências da guild: o preview tem que mostrar a
  // mesma barra lateral que o Discord vai desenhar.
  const [{ config }, general] = await Promise.all([
    loadModuleConfig(guildId, 'welcome'),
    loadGeneralPage(guildId),
  ]);

  return (
    <>
      <ScreenHeader
        kicker="CONFIGURAÇÃO"
        title={CONFIG_PAGES.welcome.title}
        meta={CONFIG_PAGES.welcome.description}
      />
      <WelcomeConfigForm
        values={config}
        embedColor={general.settings.embedColor}
        readOnly={!hasAccess(session.level, 'admin')}
      />
    </>
  );
}
