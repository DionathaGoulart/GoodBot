import { ScreenHeader } from '@/components/retro/screen-header';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { CONFIG_PAGES } from '@/lib/config-pages';
import { loadModuleConfig } from '@/lib/module-config';

import { SquadsConfigForm } from './form';

export const metadata = { title: 'Buscar squad · Goodbot' };

/**
 * PRD §5.11 e §6.2: o módulo não tem tabela, então a tela lê só o próprio
 * config. Salas, cargos e jogatinas são estado do Discord e aparecem lá, no
 * painel fixo que o botão do topo publica.
 */
export default async function SquadsConfigPage({
  params,
}: PageProps<'/g/[guildId]/config/squads'>) {
  const { guildId } = await params;
  const session = await requireGuildAccess(guildId);
  const { config } = await loadModuleConfig(guildId, 'squads');

  return (
    <>
      <ScreenHeader
        kicker="CONFIGURAÇÃO"
        title={CONFIG_PAGES.squads.title}
        meta={CONFIG_PAGES.squads.description}
      />
      <SquadsConfigForm
        values={config}
        published={
          config.panelChannelId && config.panelMessageId
            ? { channelId: config.panelChannelId, messageId: config.panelMessageId }
            : null
        }
        readOnly={!hasAccess(session.level, 'admin')}
      />
    </>
  );
}
