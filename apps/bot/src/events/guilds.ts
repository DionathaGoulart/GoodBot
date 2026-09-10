import { Events } from 'discord.js';

import { defineEvent } from '../lib/event';
import { markGuildRowLeft, prepareGuild, processTuner } from '../lib/guild-setup';

/**
 * O bot entrou num servidor. Quem decide o que acontece a seguir é o registro:
 * o convite normal deixa a linha em `pending` (o bot fica calado até a
 * aprovação), a demo já entra atendida, e um servidor bloqueado é abandonado
 * na hora.
 */
export const guildCreate = defineEvent(Events.GuildCreate, async (ctx, guild) => {
  const entry = await ctx.registry.register({ guildId: guild.id });
  ctx.logger.info(
    { guildId: guild.id, name: guild.name, status: entry.status },
    'bot adicionado a uma guild',
  );

  if (entry.status === 'blocked') {
    ctx.logger.warn({ guildId: guild.id }, 'guild bloqueada; saindo');
    await guild.leave().catch((error: unknown) => {
      ctx.logger.error({ err: error, guildId: guild.id }, 'não consegui sair da guild');
    });
    return;
  }

  if (!ctx.registry.serves(guild.id)) return;

  // Já atendida na entrada (demo, ou aprovada antes de o bot ser convidado):
  // sem isto ela ficaria sem slash command até o próximo reinício.
  processTuner.record(guild.id, await prepareGuild(ctx, guild));
  processTuner.apply(ctx);
});

export const guildDelete = defineEvent(Events.GuildDelete, async (ctx, guild) => {
  ctx.logger.warn({ guildId: guild.id, name: guild.name }, 'bot removido de uma guild');
  // Soft delete: os casos e a config continuam lá se o bot voltar. O status no
  // registro também fica — voltar não precisa de aprovação de novo.
  await markGuildRowLeft(ctx, guild.id);
  await ctx.registry.markLeft(guild.id);
  processTuner.forget(guild.id);
  ctx.config.invalidate(guild.id);
});
