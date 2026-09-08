import { Panel } from '@/components/retro/panel';
import { ScreenHeader } from '@/components/retro/screen-header';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { CONFIG_PAGES } from '@/lib/config-pages';
import { loadChannelNames } from '@/lib/discord';
import { loadGeneralPage, loadModuleConfig } from '@/lib/module-config';
import { loadSocial } from '@/lib/social';

import { AccountsTable } from './accounts';
import { SocialConfigForm } from './form';

export const metadata = { title: 'Redes sociais · CoBot' };

export default async function SocialConfigPage({
  params,
}: PageProps<'/g/[guildId]/config/social'>) {
  const { guildId } = await params;
  const session = await requireGuildAccess(guildId);
  const [{ config }, social, general, channelNames] = await Promise.all([
    loadModuleConfig(guildId, 'social'),
    loadSocial(guildId),
    loadGeneralPage(guildId),
    loadChannelNames(guildId),
  ]);
  const readOnly = !hasAccess(session.level, 'admin');

  return (
    <>
      <ScreenHeader
        kicker="CONFIGURAÇÃO"
        title={CONFIG_PAGES.social.title}
        meta={CONFIG_PAGES.social.description}
      />

      {social.error ? (
        <Panel title="ERRO.LOG" tone="error">
          <p>{social.error}</p>
          <p className="screen-meta">
            As contas ficam no banco; a lista volta assim que o bot responder.
          </p>
        </Panel>
      ) : null}

      <AccountsTable
        accounts={social.accounts}
        channelNames={channelNames}
        embedColor={general.settings.embedColor}
        readOnly={readOnly}
      />
      <SocialConfigForm values={config} readOnly={readOnly} />
    </>
  );
}
