import { ChannelType, PermissionFlagsBits } from 'discord.js';

import type { Guild, GuildBasedChannel, GuildTextBasedChannel } from 'discord.js';

/**
 * O bot consegue escrever aqui? A tela de mensagens (§6.2) mostra o canal
 * mesmo assim, desabilitado e com o motivo — some da lista é pior, porque
 * quem configurou o canal fica sem entender para onde ele foi.
 */
export function canBotSend(channel: GuildBasedChannel): boolean {
  if (!channel.isTextBased()) return false;
  const me = channel.guild.members.me;
  if (!me) return false;
  const permissions = channel.permissionsFor(me);
  return (
    permissions?.has(PermissionFlagsBits.ViewChannel) === true &&
    permissions.has(PermissionFlagsBits.SendMessages)
  );
}

/**
 * Onde o bot fala com o servidor sobre si mesmo: manutenção de deploy,
 * broadcast do dono e fim da demonstração.
 *
 * Primeiro o canal escolhido em `guild_settings.notice_channel_id`, que é a
 * resposta de quem configurou o servidor. Sem escolha (ou com um canal que
 * sumiu, virou voz ou calou o bot), o canal de sistema do Discord, onde essas
 * mensagens caíam antes do campo existir. Sem ele também, o primeiro canal de
 * texto onde o bot consegue falar, na ordem da barra lateral: um recado que
 * ninguém lê é melhor do que recado nenhum, e "o bot sumiu sem avisar" é
 * justamente o que estes avisos evitam.
 */
export function noticeChannel(
  guild: Guild,
  configuredId?: string | null,
): GuildTextBasedChannel | null {
  if (configuredId) {
    const chosen = guild.channels.cache.get(configuredId);
    if (chosen?.isTextBased() && canBotSend(chosen)) return chosen;
  }

  const system = guild.systemChannel;
  if (system && canBotSend(system)) return system;

  const candidates = [...guild.channels.cache.values()]
    .filter((channel) => channel.type === ChannelType.GuildText)
    .sort((a, b) => a.rawPosition - b.rawPosition);
  return candidates.find((channel) => canBotSend(channel)) ?? null;
}
