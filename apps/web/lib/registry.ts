import 'server-only';

import { listServedGuildIds } from '@goodbot/db';
import { cache } from 'react';

import { db } from './db';

/**
 * Os servidores que o bot atende, lidos do registro (`guild_registry`). É
 * esta tabela — e não o `GUILD_IDS` — que diz quais guilds existem para o
 * painel.
 *
 * O `cache` do React memoiza por requisição: um render toca isto em vários
 * pontos (layout, sessão, seletor) e todos devem enxergar a mesma lista sem
 * repetir a query.
 */
export const servedGuildIds = cache(async (): Promise<string[]> => listServedGuildIds(db()));

export async function isServedGuild(guildId: string): Promise<boolean> {
  return (await servedGuildIds()).includes(guildId);
}
