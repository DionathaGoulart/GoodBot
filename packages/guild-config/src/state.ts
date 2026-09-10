import type { CurrentState } from './plan';
import type { GuildChannelDetail, InternalClient } from '@goodbot/shared';

/**
 * O resumo de canal não traz tópico, nsfw, slowmode nem overrides — e é
 * exatamente isso que o diff precisa comparar. Então cada canal existente
 * custa um GET a mais. É o preço de saber o que já está certo e não reescrever.
 */
export async function fetchState(
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

/** Quantas chamadas o `fetchState` gasta numa guild com N canais. */
export const stateCallCount = (channelCount: number): number => 2 + channelCount;
