import { Events } from 'discord.js';

import { defineEvent } from '../../lib/event';

/** Anti-raid: conta a entrada e aplica a ação quando o modo raid está ativo. */
export const automodGuildMemberAdd = defineEvent(Events.GuildMemberAdd, async (ctx, member) => {
  await ctx.automod.handleMemberAdd(member);
});
