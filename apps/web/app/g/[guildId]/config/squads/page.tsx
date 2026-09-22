import { Panel } from '@/components/retro/panel';
import { ScreenHeader } from '@/components/retro/screen-header';
import { hasAccess } from '@/lib/auth/access';
import { requireGuildAccess } from '@/lib/auth/require';
import { CONFIG_PAGES } from '@/lib/config-pages';
import { loadChannelNames } from '@/lib/discord';
import { loadGeneralPage, loadModuleConfig } from '@/lib/module-config';
import {
  loadSearchingCounts,
  loadSquadGames,
  loadSquadPlayers,
  loadSquadSessions,
  loadSquadsOverview,
} from '@/lib/squads';

import { SquadsConfigForm } from './form';
import { SquadsTabs } from './tabs';

export const metadata = { title: 'Squads · Goodbot' };

export default async function SquadsConfigPage({
  params,
}: PageProps<'/g/[guildId]/config/squads'>) {
  const { guildId } = await params;
  const session = await requireGuildAccess(guildId);
  const readOnly = !hasAccess(session.level, 'admin');
  const gamesLoad = loadSquadGames(guildId);
  const configLoad = loadModuleConfig(guildId, 'squads');
  const [{ config }, games, searchingCounts, overview, general, channelNames, sessions, players] =
    await Promise.all([
      configLoad,
      gamesLoad,
      loadSearchingCounts(guildId),
      loadSquadsOverview(guildId),
      loadGeneralPage(guildId),
      loadChannelNames(guildId),
      loadSquadSessions(guildId),
      // Perfis, respostas e nomes são só de admin: para quem só lê, nem saem do banco.
      readOnly
        ? Promise.resolve(null)
        : Promise.all([gamesLoad, configLoad]).then(([rows, module]) =>
            loadSquadPlayers(guildId, rows, module.config),
          ),
    ]);
  const searching = Object.values(searchingCounts).reduce((sum, count) => sum + count, 0);

  return (
    <>
      <ScreenHeader
        kicker="CONFIGURAÇÃO"
        title={CONFIG_PAGES.squads.title}
        meta={`${games.length} JOGOS · ${overview.squads.length} SQUADS · ${searching} PROCURANDO`}
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
        searchingCounts={searchingCounts}
        sessions={sessions}
        players={players}
        blocks={config.blocks}
        maxSquadsPerUser={config.maxSquadsPerUser}
        cooldownDays={config.reproposeCooldownDays}
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
