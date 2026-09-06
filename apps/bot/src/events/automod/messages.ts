import { Events } from 'discord.js';

import { defineEvent } from '../../lib/event';

/**
 * Automod em `messageCreate`. Roda em paralelo ao handler de logs: cada
 * evento tem o seu listener, e uma exceção num deles não afeta o outro
 * (ver `loadEvents`).
 */
export const automodMessageCreate = defineEvent(Events.MessageCreate, async (ctx, message) => {
  if (!message.guildId || message.author.bot) return;
  await ctx.automod.handleMessage(message);
});

/** Edição re-avalia a mensagem quando `automod.checkEdits` está ligado. */
export const automodMessageUpdate = defineEvent(
  Events.MessageUpdate,
  async (ctx, _oldMessage, newMessage) => {
    if (!newMessage.guildId) return;
    const message = newMessage.partial ? await newMessage.fetch().catch(() => null) : newMessage;
    if (!message || message.author.bot) return;
    await ctx.automod.handleMessage(message, { isEdit: true });
  },
);
