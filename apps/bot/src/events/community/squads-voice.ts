import { Events } from 'discord.js';

import { defineEvent } from '../../lib/event';

/**
 * Voices do pool de squads. Quem é do squad e entra no voice reservado
 * confirma que o squad joga e abre a presença no histórico; sair de um voice
 * do pool fecha a presença, e o voice reservado que esvazia depois do início
 * libera a reserva antes do fim da jogatina. Mute, deafen e stream não mudam
 * de canal e ficam de fora, e só voice do pool chega a consultar o banco.
 *
 * A saída vem antes da entrada: quem pula de um voice do pool para outro
 * fecharia a presença nova junto com a velha, porque fechar é por pessoa.
 */
export const squadVoiceStateUpdate = defineEvent(
  Events.VoiceStateUpdate,
  async (ctx, oldState, newState) => {
    if (oldState.channelId === newState.channelId) return;
    if ((newState.member ?? oldState.member)?.user.bot) return;

    const guild = newState.guild;
    const config = await ctx.config.get(guild.id, 'squads');
    if (!config.enabled || config.voicePoolIds.length === 0) return;
    const pool = new Set(config.voicePoolIds);

    if (oldState.channelId && pool.has(oldState.channelId)) {
      await ctx.squads.recordVoiceLeave(guild, oldState.id);
      await ctx.squads.releaseEmptyVoice(guild, oldState.channelId);
    }
    if (newState.channelId && pool.has(newState.channelId)) {
      await ctx.squads.confirmVoicePresence(guild, newState.channelId, newState.id);
    }
  },
);
