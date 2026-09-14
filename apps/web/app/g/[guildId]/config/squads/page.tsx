import { Panel } from '@/components/retro/panel';
import { ScreenHeader } from '@/components/retro/screen-header';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { CONFIG_PAGES } from '@/lib/config-pages';
import { loadChannelNames } from '@/lib/discord';
import { loadGeneralPage, loadModuleConfig } from '@/lib/module-config';
import { loadSearchingProfiles, loadSquadGames, loadSquadsOverview } from '@/lib/squads';

import { SquadsConfigForm } from './form';
import { SquadsTabs } from './tabs';

export const metadata = { title: 'Squads · Goodbot' };

export default async function SquadsConfigPage({
  params,
}: PageProps<'/g/[guildId]/config/squads'>) {
  const { guildId } = await params;
  const session = await requireGuildAccess(guildId);
  const gamesLoad = loadSquadGames(guildId);
  const [{ config }, games, searching, overview, general, channelNames] = await Promise.all([
    loadModuleConfig(guildId, 'squads'),
    gamesLoad,
    gamesLoad.then((rows) =>
      loadSearchingProfiles(
        guildId,
        rows.map((row) => row.id),
      ),
    ),
    loadSquadsOverview(guildId),
    loadGeneralPage(guildId),
    loadChannelNames(guildId),
  ]);
  const readOnly = !hasAccess(session.level, 'admin');

  return (
    <>
      <ScreenHeader
        kicker="CONFIGURAÇÃO"
        title={CONFIG_PAGES.squads.title}
        meta={`${games.length} JOGOS · ${overview.squads.length} SQUADS · ${searching.length} PROCURANDO`}
      />

      {overview.error ? (
        <Panel title="ERRO.LOG" tone="error">
          <p>{overview.error}</p>
          <p className="screen-meta">
            Squads, propostas e o contador de canais vêm do bot. Jogos e configuração continuam
            editáveis.
          </p>
        </Panel>
      ) : null}

      <SquadsTabs
        games={games}
        overview={overview}
        searching={searching}
        blocks={config.blocks}
        searchChannelId={config.searchChannelId}
        searchMessageId={config.searchMessageId}
        channelNames={channelNames}
        timeZone={general.settings.timezone}
        readOnly={readOnly}
        configSlot={<SquadsConfigForm values={config} readOnly={readOnly} />}
      />
    </>
  );
}
