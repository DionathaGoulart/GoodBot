import { Events } from 'discord.js';

import { defineEvent } from '../../lib/event';

/**
 * Voices de squads: os do pool e os temporários, criados quando o pool está
 * cheio. Quem é do squad e entra no voice reservado confirma que o squad joga
 * e abre a presença no histórico; sair de um desses voices fecha a presença, e
 * o voice reservado que esvazia depois do início libera a reserva antes do fim
 * da jogatina (o temporário é apagado). Mute, deafen e stream não mudam de
 * canal e ficam de fora, e só voice de squad chega a consultar o banco: os
 * temporários o service responde de memória.
 *
 * A saída vem antes da entrada: quem pula de um voice de squad para outro
 * fecharia a presença nova junto com a velha, porque fechar é por pessoa.
 */
export const squadVoiceStateUpdate = defineEvent(
  Events.VoiceStateUpdate,
  async (ctx, oldState, newState) => {
    if (oldState.channelId === newState.channelId) return;
    if ((newState.member ?? oldState.member)?.user.bot) return;

    const guild = newState.guild;
    const config = await ctx.config.get(guild.id, 'squads');
    if (!config.enabled) return;
    const pool = new Set(config.voicePoolIds);
    const isSquadVoice = async (channelId: string): Promise<boolean> =>
      pool.has(channelId) || (await ctx.squads.isTemporaryVoice(guild.id, channelId));

    const left = oldState.channelId;
    if (left && (await isSquadVoice(left))) {
      await ctx.squads.recordVoiceLeave(guild, oldState.id);
      await ctx.squads.releaseEmptyVoice(guild, left);
    }
    const joined = newState.channelId;
    if (joined && (await isSquadVoice(joined))) {
      await ctx.squads.confirmVoicePresence(guild, joined, newState.id);
    }
  },
);
