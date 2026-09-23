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

/** Voz: entrar cancela o prazo do cargo de busca, sair de todas abre a janela. */
export const squadVoiceStateUpdate = defineEvent(
  Events.VoiceStateUpdate,
  async (ctx, oldState, newState) => {
    await ctx.squads.onVoiceState(oldState, newState);
  },
);
