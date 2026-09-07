import 'server-only';

import type { CommandSummary } from '@cobot/shared';

import { cachedInternalApi } from './internal-api';

/** O manifesto muda só quando o bot sobe; um minuto de cache basta. */
const CACHE_SECONDS = 60;

/**
 * A lista de comandos vem do bot (`GET /commands`), nunca de uma cópia no
 * painel: assim um comando novo aparece na tela sem deploy do dashboard.
 * `null` = bot offline (§8), a página mostra o banner em vez da tabela.
 */
export async function loadCommands(guildId: string): Promise<CommandSummary[] | null> {
  try {
    return await cachedInternalApi(CACHE_SECONDS).commands(guildId);
  } catch {
    return null;
  }
}
