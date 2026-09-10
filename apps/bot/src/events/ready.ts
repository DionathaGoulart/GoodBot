import { Events } from 'discord.js';

import { env } from '../env';
import { upsertGuild } from './guilds';
import { defineEvent } from '../lib/event';
import { syncCommands } from '../lib/registry';

import type { BotContext } from '../lib/command';
import type { Guild } from 'discord.js';

/** `--force` no argv força o re-registro mesmo com o hash igual. */
const FORCE_REGISTER = process.argv.includes('--force');

/**
 * O LRU de mensagens e o intervalo de flush das estatísticas são recursos do
 * **processo**, não da guild, mas a config de cada um vive por guild. Com mais
 * de uma guild os valores conflitam, e a resolução é a que não perde dado:
 * o maior cache e o menor intervalo atendem a guild mais exigente, e sobra
 * folga para as outras.
 */
interface ProcessTuning {
  perChannel: number;
  flushSeconds: number;
}

async function prepareGuild(ctx: BotContext, guild: Guild): Promise<ProcessTuning> {
  await upsertGuild(ctx, guild);

  // O GUILD_CREATE não garante a lista completa de membros, então o cache
  // nascia com o bot e quem apareceu num evento — era isso que fazia o
  // painel listar 2 de 13. Um GUILD_REQUEST_MEMBERS no boot enche o cache;
  // depois os eventos de entrada/saída o mantêm (PRD §7.4: nada em loop).
  try {
    const members = await guild.members.fetch();
    ctx.logger.info(
      { guildId: guild.id, cached: members.size, total: guild.memberCount },
      'cache de membros',
    );
  } catch (error) {
    ctx.logger.error(
      { err: error, guildId: guild.id },
      'não consegui carregar os membros; confira a intent GuildMembers no portal',
    );
  }

  // Aquece o cache de config antes de aceitar interações.
  await ctx.config.warm(guild.id);

  const logsConfig = await ctx.config.get(guild.id, 'logs');
  const statsConfig = await ctx.config.get(guild.id, 'stats');

  // Guild commands são registrados por guild: cada uma tem o seu hash, então
  // acrescentar um servidor não re-registra os comandos dos outros.
  await syncCommands({
    db: ctx.db,
    token: env.DISCORD_TOKEN,
    clientId: env.DISCORD_CLIENT_ID,
    guildId: guild.id,
    commands: ctx.commands.values(),
    force: FORCE_REGISTER,
  });

  return {
    perChannel: logsConfig.messageCache.perChannel,
    flushSeconds: statsConfig.flushIntervalSeconds,
  };
}

export default defineEvent(
  Events.ClientReady,
  async (ctx, client) => {
    const presentes: Guild[] = [];
    const ausentes: string[] = [];
    for (const guildId of env.guildIds) {
      const guild = client.guilds.cache.get(guildId);
      if (guild) presentes.push(guild);
      else ausentes.push(guildId);
    }

    ctx.logger.info(
      {
        user: client.user.tag,
        guilds: presentes.map((g) => ({ id: g.id, name: g.name, members: g.memberCount })),
        cached: client.guilds.cache.size,
      },
      'ready',
    );

    // Uma guild ausente não impede as outras de subir: convidar o bot é uma
    // ação manual e pode estar pendente só para a mais nova.
    if (ausentes.length > 0) {
      ctx.logger.error(
        { guildIds: ausentes },
        'o bot não está nestas guilds; convide-o pelo OAuth2 URL Generator',
      );
    }
    if (presentes.length === 0) return;

    const tunings: ProcessTuning[] = [];
    for (const guild of presentes) {
      tunings.push(await prepareGuild(ctx, guild));
    }

    ctx.messageCache.setPerChannel(Math.max(...tunings.map((t) => t.perChannel)));
    ctx.stats.setFlushInterval(Math.min(...tunings.map((t) => t.flushSeconds)));
  },
  { once: true },
);
