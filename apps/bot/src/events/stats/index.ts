import { Events } from 'discord.js';

import { defineEvent } from '../../lib/event';

import type { EventHandler } from '../../lib/event';

/**
 * Coleta de stats (PRD §5.6). Listeners próprios, separados dos de log e de
 * automod: contar mensagens não pode depender de um módulo que o servidor
 * desligou, nem derrubá-lo (ver `loadEvents`).
 */
export const statsMessageCreate = defineEvent(Events.MessageCreate, async (ctx, message) => {
  if (!message.guildId) return;
  await ctx.stats.recordMessage(message);
});

export const statsMemberAdd = defineEvent(Events.GuildMemberAdd, async (ctx, member) => {
  await ctx.stats.recordJoin(member);
});

export const statsMemberRemove = defineEvent(Events.GuildMemberRemove, async (ctx, member) => {
  await ctx.stats.recordLeave(member);
});

export const statsVoiceStateUpdate = defineEvent(
  Events.VoiceStateUpdate,
  async (ctx, oldState, newState) => {
    await ctx.stats.recordVoice(oldState, newState);
  },
);

export const statsEvents: readonly EventHandler[] = [
  statsMessageCreate,
  statsMemberAdd,
  statsMemberRemove,
  statsVoiceStateUpdate,
];
