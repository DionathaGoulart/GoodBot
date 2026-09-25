import { ScreenHeader } from '@/components/retro/screen-header';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { CONFIG_PAGES } from '@/lib/config-pages';
import { loadModuleConfig } from '@/lib/module-config';

import { SquadsConfigForm } from './form';

import type { PublishedGuides } from './form';

export const metadata = { title: 'Buscar squad · Goodbot' };

function published(channelId: string | null, messageId: string | null) {
  return channelId && messageId ? { channelId, messageId } : null;
}

/**
 * PRD §5.11 e §6.2: a tela lê só o próprio config. Salas e cargo são estado do
 * Discord; cards e jogatinas têm tabela, mas vivem nos canais, não aqui.
 */
export default async function SquadsConfigPage({
  params,
}: PageProps<'/g/[guildId]/config/squads'>) {
  const { guildId } = await params;
  const session = await requireGuildAccess(guildId);
  const { config } = await loadModuleConfig(guildId, 'squads');
  const guides: PublishedGuides = {
    chatGuide: published(config.chatChannelId, config.chatGuideMessageId),
    deskGuide: published(config.deskChannelId, config.deskGuideMessageId),
    deskButtons: published(config.deskChannelId, config.deskButtonsMessageId),
  };

  return (
    <>
      <ScreenHeader
        kicker="CONFIGURAÇÃO"
        title={CONFIG_PAGES.squads.title}
        meta={CONFIG_PAGES.squads.description}
      />
      <SquadsConfigForm
        values={config}
        published={guides}
        readOnly={!hasAccess(session.level, 'admin')}
      />
    </>
  );
}
