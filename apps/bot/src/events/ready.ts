import { Events } from 'discord.js';

import { defineEvent } from '../lib/event';
import { prepareGuild, processTuner } from '../lib/guild-setup';

import type { BotContext } from '../lib/command';
import type { Client, Guild } from 'discord.js';

/**
 * Guilds em que o bot está mas **não** atende. Cada uma ganha (ou já tem) uma
 * linha no registro, para aparecer na fila do painel admin; as bloqueadas o
 * bot abandona na hora — estar num servidor bloqueado é o que o bloqueio
 * existe para evitar.
 */
async function handleUnserved(ctx: BotContext, client: Client): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    if (ctx.registry.serves(guild.id)) continue;

    const entry = await ctx.registry.register({ guildId: guild.id });
    if (entry.status === 'blocked') {
      ctx.logger.warn({ guildId: guild.id, name: guild.name }, 'guild bloqueada; saindo');
      await guild.leave().catch((error: unknown) => {
        ctx.logger.error({ err: error, guildId: guild.id }, 'não consegui sair da guild');
      });
      continue;
    }
    ctx.logger.info(
      { guildId: guild.id, name: guild.name, status: entry.status },
      'guild não atendida; o bot fica calado nela',
    );
  }
}

export default defineEvent(
  Events.ClientReady,
  async (ctx, client) => {
    // A fronteira é o registro: o `GUILD_IDS` já foi semeado no boot e daqui
    // em diante quem manda é a tabela.
    const presentes: Guild[] = [];
    const ausentes: string[] = [];
    for (const guildId of ctx.registry.servedGuildIds()) {
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

    // Uma guild ausente não impede as outras de subir: o registro guarda quem
    // já foi aprovado, e o bot pode ter sido removido de lá enquanto estava fora.
    if (ausentes.length > 0) {
      ctx.logger.error(
        { guildIds: ausentes },
        'aprovadas no registro, mas o bot não está nelas; convide-o de novo',
      );
    }

    await handleUnserved(ctx, client);
    if (presentes.length === 0) return;

    for (const guild of presentes) {
      processTuner.record(guild.id, await prepareGuild(ctx, guild));
    }
    processTuner.apply(ctx);
  },
  { once: true },
);
