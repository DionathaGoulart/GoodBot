import { Events } from 'discord.js';

import { env } from '../env';
import { upsertGuild } from './guilds';
import { defineEvent } from '../lib/event';
import { syncCommands } from '../lib/registry';

/** `--force` no argv força o re-registro mesmo com o hash igual. */
const FORCE_REGISTER = process.argv.includes('--force');

export default defineEvent(
  Events.ClientReady,
  async (ctx, client) => {
    const guild = client.guilds.cache.get(env.GUILD_ID);

    ctx.logger.info(
      {
        user: client.user.tag,
        guild: guild ? { id: guild.id, name: guild.name, members: guild.memberCount } : null,
        guilds: client.guilds.cache.size,
      },
      'ready',
    );

    if (!guild) {
      ctx.logger.error(
        { guildId: env.GUILD_ID },
        'o bot não está na guild de GUILD_ID; convide-o pelo OAuth2 URL Generator',
      );
      return;
    }

    await upsertGuild(ctx, guild);

    // Aquece o cache de config antes de aceitar interações.
    await ctx.config.warm(guild.id);

    // O LRU de mensagens dimensiona-se pela config da guild (single-server).
    const logsConfig = await ctx.config.get(guild.id, 'logs');
    ctx.messageCache.setPerChannel(logsConfig.messageCache.perChannel);

    const statsConfig = await ctx.config.get(guild.id, 'stats');
    ctx.stats.setFlushInterval(statsConfig.flushIntervalSeconds);

    await syncCommands({
      db: ctx.db,
      token: env.DISCORD_TOKEN,
      clientId: env.DISCORD_CLIENT_ID,
      guildId: guild.id,
      commands: ctx.commands.values(),
      force: FORCE_REGISTER,
    });
  },
  { once: true },
);
