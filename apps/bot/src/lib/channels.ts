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
 * Onde falar com o servidor quando não há canal configurado para o assunto —
 * hoje, os avisos de fim da demo (plano, Etapa 3).
 *
 * Primeiro o canal de sistema, que é onde o Discord já põe as mensagens de
 * entrada e é o que o dono do servidor espera. Sem ele (ou sem permissão de
 * escrever lá), o primeiro canal de texto onde o bot consegue falar, na ordem
 * em que aparecem na barra lateral: um recado que ninguém lê é melhor do que
 * recado nenhum, e "o bot saiu sem avisar" é exatamente o que a etapa evita.
 */
export function noticeChannel(guild: Guild): GuildTextBasedChannel | null {
  const system = guild.systemChannel;
  if (system && canBotSend(system)) return system;

  const candidates = [...guild.channels.cache.values()]
    .filter((channel) => channel.type === ChannelType.GuildText)
    .sort((a, b) => a.rawPosition - b.rawPosition);
  return candidates.find((channel) => canBotSend(channel)) ?? null;
}
