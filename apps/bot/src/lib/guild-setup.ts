import { guilds } from '@goodbot/db';
import { eq, sql } from 'drizzle-orm';

import { env } from '../env';
import { syncCommands } from './registry';

import type { BotContext } from './command';
import type { Guild } from 'discord.js';

/** `--force` no argv força o re-registro mesmo com o hash igual. */
const FORCE_REGISTER = process.argv.includes('--force');

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

/** Soft delete da linha em `guilds`: casos e config ficam se o bot voltar. */
export async function markGuildRowLeft(ctx: BotContext, guildId: string): Promise<void> {
  await ctx.db
    .update(guilds)
    .set({ leftAt: sql`now()` })
    .where(eq(guilds.id, guildId));
}

/**
 * O LRU de mensagens e o intervalo de flush das estatísticas são recursos do
 * **processo**, não da guild, mas a config de cada um vive por guild. Com mais
 * de uma guild os valores conflitam, e a resolução é a que não perde dado:
 * o maior cache e o menor intervalo atendem a guild mais exigente, e sobra
 * folga para as outras.
 */
export interface ProcessTuning {
  perChannel: number;
  flushSeconds: number;
}

/**
 * Guarda o que cada guild pediu e resolve o conflito a cada mudança. É uma
 * classe, e não um `Math.max` no `ready`, porque desde a Etapa 1 uma guild
 * pode entrar depois do boot: sem memória do que as outras pediram, preparar
 * a nova encolheria o cache de todas.
 */
export class ProcessTuner {
  private readonly perGuild = new Map<string, ProcessTuning>();

  record(guildId: string, tuning: ProcessTuning): void {
    this.perGuild.set(guildId, tuning);
  }

  forget(guildId: string): void {
    this.perGuild.delete(guildId);
  }

  /** Aplica o resultado nos dois serviços do processo. Sem guild, não mexe. */
  apply(ctx: BotContext): void {
    const tunings = [...this.perGuild.values()];
    if (tunings.length === 0) return;
    ctx.messageCache.setPerChannel(Math.max(...tunings.map((t) => t.perChannel)));
    ctx.stats.setFlushInterval(Math.min(...tunings.map((t) => t.flushSeconds)));
  }
}

/**
 * Instância única do processo: o `ready` e o `guildCreate` alimentam o mesmo
 * tuner, e é a soma dos dois que decide os valores.
 */
export const processTuner = new ProcessTuner();

/**
 * Deixa uma guild pronta para ser atendida: linha em `guilds`, cache de
 * membros, config aquecida e slash commands registrados. Roda no `ready` para
 * cada guild atendida e no `guildCreate` de quem já entra atendido (demo).
 */
export async function prepareGuild(ctx: BotContext, guild: Guild): Promise<ProcessTuning> {
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
