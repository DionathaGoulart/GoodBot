import { Events } from 'discord.js';

import { defineEvent } from '../../lib/event';

/**
 * Voz: as salas do módulo (PRD §5.11). Entrar numa sala cancela o prazo dela e
 * a última pessoa saindo abre a janela de tolerância. O loader já descarta
 * guild que o bot não atende; o service descarta o resto cedo.
 */
export const squadVoiceStateUpdate = defineEvent(
  Events.VoiceStateUpdate,
  async (ctx, oldState, newState) => {
    await ctx.squadRooms.onVoiceState(oldState, newState);
  },
);
