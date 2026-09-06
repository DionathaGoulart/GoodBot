import { Events } from 'discord.js';

import { defineEvent } from '../../lib/event';

/**
 * Entrada e saída do ponto de vista do módulo `welcome`/`autorole`. Os logs de
 * evento têm handlers próprios em `events/logs/members.ts`: um módulo
 * desligado não pode calar o outro.
 */
export const welcomeMemberAdd = defineEvent(Events.GuildMemberAdd, async (ctx, member) => {
  await ctx.welcome.onJoin(member);
  await ctx.autorole.onJoin(member);
});

export const welcomeMemberRemove = defineEvent(Events.GuildMemberRemove, async (ctx, member) => {
  await ctx.welcome.onLeave(member);
});
