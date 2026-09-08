import 'server-only';

import { cachedInternalApi } from './internal-api';

/** Os canais mudam pouco; um minuto de cache é o mesmo do `DiscordPicker`. */
const CACHE_SECONDS = 60;

/**
 * `id → #nome` dos canais da guild, para as tabelas mostrarem nome em vez de
 * snowflake. Bot fora do ar devolve `{}`: a tabela cai para o ID, que ainda é
 * legível, em vez de sumir com a coluna.
 */
export async function loadChannelNames(guildId: string): Promise<Record<string, string>> {
  try {
    const channels = await cachedInternalApi(CACHE_SECONDS).channels(guildId);
    return Object.fromEntries(channels.map((channel) => [channel.id, `#${channel.name}`]));
  } catch {
    return {};
  }
}

/** Idem para cargos (`@nome`). */
export async function loadRoleNames(guildId: string): Promise<Record<string, string>> {
  try {
    const roles = await cachedInternalApi(CACHE_SECONDS).roles(guildId);
    // O `@everyone` já vem com `@` no nome — dobrar viraria `@@everyone`.
    return Object.fromEntries(
      roles.map((role) => [role.id, role.name.startsWith('@') ? role.name : `@${role.name}`]),
    );
  } catch {
    return {};
  }
}
