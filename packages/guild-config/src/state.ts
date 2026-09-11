import { InternalApiError } from '@goodbot/shared';

import type { CurrentState } from './plan';
import type { GuildChannelDetail, InternalClient } from '@goodbot/shared';

/**
 * O retrato do servidor: cargos, canais e o detalhe de cada canal — tópico,
 * nsfw, slowmode e overrides —, que é exatamente o que o diff compara.
 *
 * O bot serve tudo isso numa resposta só (`GET /guilds/:id/state`), montada do
 * cache do gateway. Antes o caminho era pedir peça por peça, e cada canal
 * custava um GET: num servidor de trinta canais, trinta idas e voltas em série
 * até a VM. A rota nova é uma.
 */
export async function fetchState(
  api: InternalClient,
  guildId: string,
  onCall: () => Promise<void>,
): Promise<CurrentState> {
  await onCall();
  try {
    const state = await api.guildState(guildId);
    return {
      roles: state.roles,
      channels: state.channels,
      details: new Map(state.details.map((detail) => [detail.id, detail])),
    };
  } catch (error) {
    // Bot mais antigo que este CLI: a rota ainda não existe lá. Acontece na
    // janela entre publicar o pacote e subir a VM, e cair no caminho lento é
    // melhor do que parar com um 404 que não explica nada.
    if (!(error instanceof InternalApiError) || error.status !== 404) throw error;
    return await fetchStatePieceByPiece(api, guildId, onCall);
  }
}

/** O caminho de antes do `GET /state`: `2 + N` chamadas. Só para bot antigo. */
async function fetchStatePieceByPiece(
  api: InternalClient,
  guildId: string,
  onCall: () => Promise<void>,
): Promise<CurrentState> {
  await onCall();
  const roles = await api.roles(guildId);

  await onCall();
  const channels = await api.channels(guildId);

  const details = new Map<string, GuildChannelDetail>();
  for (const channel of channels) {
    await onCall();
    try {
      details.set(channel.id, await api.channel(guildId, channel.id));
    } catch {
      // Canal que o bot não enxerga não entra no diff; o plano vai tratá-lo
      // como ausente em vez de fingir que sabe o estado dele.
    }
  }

  return { roles, channels, details };
}

/** Quantas chamadas o caminho lento gasta numa guild com N canais. */
export const stateCallCount = (channelCount: number): number => 2 + channelCount;
