import 'server-only';

import { configuredGuildIds } from './auth/require';
import { cachedInternalApi } from './internal-api';

export interface ManagedGuild {
  id: string;
  name: string;
}

/**
 * Nome de cada guild que o painel gerencia, para o seletor da barra lateral.
 *
 * O cache de 60 s do `cachedInternalApi` é o que torna isto barato: o layout
 * roda em toda navegação, e sem ele cada troca de página custaria uma chamada
 * por servidor configurado.
 *
 * Guild que o bot ainda não entrou responde 404. Isso não é erro — é o estado
 * normal entre a linha aparecer no registro e o bot ser convidado —, então ela
 * aparece no seletor com o próprio ID de rótulo em vez de sumir.
 */
export async function listManagedGuilds(): Promise<ManagedGuild[]> {
  const api = cachedInternalApi(60);
  return await Promise.all(
    (await configuredGuildIds()).map(async (id) => {
      try {
        return { id, name: (await api.guildProfile(id)).name };
      } catch {
        return { id, name: id };
      }
    }),
  );
}
