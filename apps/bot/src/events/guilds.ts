import { guilds } from '@goodbot/db';
import { Events } from 'discord.js';
import { eq, sql } from 'drizzle-orm';

import { defineEvent } from '../lib/event';

import type { BotContext } from '../lib/command';
import type { Guild } from 'discord.js';

/** Upsert de `guilds` — nome/ícone/owner podem mudar entre reinícios. */
export async function upsertGuild(ctx: BotContext, guild: Guild): Promise<void> {
  await ctx.db
    .insert(guilds)
    .values({
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
      ownerId: guild.ownerId,
      leftAt: null,
    })
    .onConflictDoUpdate({
      target: guilds.id,
      set: { name: guild.name, icon: guild.icon, ownerId: guild.ownerId, leftAt: null },
    });
}

export const guildCreate = defineEvent(Events.GuildCreate, async (ctx, guild) => {
  ctx.logger.info({ guildId: guild.id, name: guild.name }, 'bot adicionado a uma guild');
  await upsertGuild(ctx, guild);
});

export const guildDelete = defineEvent(Events.GuildDelete, async (ctx, guild) => {
  ctx.logger.warn({ guildId: guild.id, name: guild.name }, 'bot removido de uma guild');
  // Soft delete: os casos e a config continuam lá se o bot voltar.
  await ctx.db
    .update(guilds)
    .set({ leftAt: sql`now()` })
    .where(eq(guilds.id, guild.id));
  ctx.config.invalidate(guild.id);
});
