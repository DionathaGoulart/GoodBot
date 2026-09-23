import { Events } from 'discord.js';

import { defineEvent } from '../../lib/event';

/**
 * Presença: o aviso automático "buscar squad?" (PRD §5.11). O loader já
 * descarta guild que o bot não atende; o service descarta o resto cedo.
 */
export const squadPresenceUpdate = defineEvent(
  Events.PresenceUpdate,
  async (ctx, _oldPresence, newPresence) => {
    await ctx.squads.onPresence(newPresence);
  },
);

/**
 * Voz: o cargo de busca (entrar cancela o prazo, sair de todas abre a janela)
 * e as salas (o canal de criar abre uma, a última pessoa saindo abre a janela).
 * Um não espera o outro: a sala nascendo não atrasa o cargo, nem o contrário.
 */
export const squadVoiceStateUpdate = defineEvent(
  Events.VoiceStateUpdate,
  async (ctx, oldState, newState) => {
    await Promise.all([
      ctx.squads.onVoiceState(oldState, newState),
      ctx.squadRooms.onVoiceState(oldState, newState),
    ]);
  },
);
