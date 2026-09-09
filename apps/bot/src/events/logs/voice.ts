import { Events } from 'discord.js';

import { defineEvent } from '../../lib/event';
import {
  channelMention,
  channelValue,
  logEmbed,
  logFooter,
  sentence,
  userIdValue,
  userMention,
  userValue,
} from '../../lib/log-embeds';

import type { APIEmbedField, VoiceState } from 'discord.js';

/** Um evento cobre join, leave, move e mute/deafen de servidor (PRD §5.4). */
export const voiceStateUpdate = defineEvent(
  Events.VoiceStateUpdate,
  async (ctx, oldState, newState) => {
    const guildId = newState.guild.id;
    const config = await ctx.config.get(guildId, 'logs');
    if (!config.enabled) return;

    const member = newState.member ?? oldState.member;
    const userId = member?.id ?? newState.id;
    const userField: APIEmbedField = {
      name: 'Usuário',
      value: member ? userValue(member.user) : userIdValue(userId),
      inline: true,
    };
    // A frase precisa do mesmo sujeito do field, mas só da menção.
    const who = member ? userMention(member.user) : userMention({ id: userId });
    const roleIds = member ? [...member.roles.cache.keys()] : undefined;
    // O canal relevante para os ignorados é o de destino (ou o de origem, na saída).
    const contextChannel = newState.channelId ?? oldState.channelId;

    const embed = voiceEmbed(oldState, newState, userField, who);
    if (!embed) return;

    await ctx.logs.emit(
      guildId,
      'voice',
      { embeds: [embed] },
      { channelId: contextChannel, roleIds },
    );
  },
);

function voiceEmbed(
  oldState: VoiceState,
  newState: VoiceState,
  userField: APIEmbedField,
  who: string,
): ReturnType<typeof logEmbed> | null {
  const footer = logFooter(`USUÁRIO: ${newState.id}`);

  if (!oldState.channelId && newState.channelId) {
    return logEmbed({
      title: 'Entrou em call',
      tone: 'create',
      description: sentence(`${who} entrou em ${channelMention(newState.channelId)}`),
      fields: [
        userField,
        {
          name: 'Canal',
          value: channelValue(newState.channelId, newState.channel?.name),
          inline: true,
        },
      ],
      footer,
    });
  }

  if (oldState.channelId && !newState.channelId) {
    return logEmbed({
      title: 'Saiu da call',
      tone: 'delete',
      description: sentence(`${who} saiu de ${channelMention(oldState.channelId)}`),
      fields: [
        userField,
        {
          name: 'Canal',
          value: channelValue(oldState.channelId, oldState.channel?.name),
          inline: true,
        },
      ],
      footer,
    });
  }

  if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
    return logEmbed({
      title: 'Mudou de call',
      tone: 'update',
      description: sentence(
        `${who} saiu de ${channelMention(oldState.channelId)}`,
        `e entrou em ${channelMention(newState.channelId)}`,
      ),
      fields: [
        userField,
        {
          name: 'De',
          value: channelValue(oldState.channelId, oldState.channel?.name),
          inline: true,
        },
        {
          name: 'Para',
          value: channelValue(newState.channelId, newState.channel?.name),
          inline: true,
        },
      ],
      footer,
    });
  }

  // Mute/deafen *do servidor*: o mute local do próprio usuário não é moderação.
  const changes: string[] = [];
  if (oldState.serverMute !== newState.serverMute) {
    changes.push(newState.serverMute ? 'mutado pelo servidor' : 'desmutado pelo servidor');
  }
  if (oldState.serverDeaf !== newState.serverDeaf) {
    changes.push(
      newState.serverDeaf ? 'ensurdecido pelo servidor' : 'desensurdecido pelo servidor',
    );
  }
  if (changes.length === 0) return null;

  return logEmbed({
    title: 'Estado de voz alterado',
    tone: 'update',
    description: sentence(
      `${who} foi ${changes.join(' e ')}`,
      newState.channelId ? `em ${channelMention(newState.channelId)}` : null,
    ),
    fields: [
      userField,
      ...(newState.channelId
        ? [
            {
              name: 'Canal',
              value: channelValue(newState.channelId, newState.channel?.name),
              inline: true,
            },
          ]
        : []),
      { name: 'Mudança', value: changes.join(', '), inline: false },
    ],
    footer,
  });
}
