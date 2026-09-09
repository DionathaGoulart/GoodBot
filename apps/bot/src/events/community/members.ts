import { Events } from 'discord.js';

import { defineEvent } from '../../lib/event';
import { boostTransition } from '../../services/welcome';

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

/**
 * Início e fim de impulso. O Discord não tem evento próprio para isso: o que
 * chega é um `guildMemberUpdate` em que `premiumSince` saiu de `null` (começou)
 * ou virou `null` (acabou). Todo outro campo do mesmo evento é ignorado aqui —
 * apelido, cargos e avatar são assunto de `events/logs/members.ts`.
 */
export const welcomeMemberBoost = defineEvent(
  Events.GuildMemberUpdate,
  async (ctx, oldMember, newMember) => {
    const transition = boostTransition(oldMember, newMember);
    if (!transition) return;

    if (transition === 'start') await ctx.welcome.onBoostStart(newMember);
    else await ctx.welcome.onBoostEnd(newMember);
  },
);
