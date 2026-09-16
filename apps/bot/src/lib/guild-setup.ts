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
 * O intervalo de flush das estatísticas é um recurso do **processo** (um timer
 * só), mas a config vive por guild. Com mais de uma guild os valores
 * conflitam, e a resolução é a que não perde dado: o menor intervalo atende a
 * guild mais exigente.
 *
 * O LRU do cache de mensagens já morou aqui, resolvido pelo **maior** valor
 * entre as guilds. Saiu porque essa regra fazia um servidor que pedisse 1000
 * mensagens por canal multiplicar a RAM de todos os outros; hoje cada canal usa
 * o `perChannel` da própria guild (`MessageCacheService.record`).
 */
export interface ProcessTuning {
  flushSeconds: number;
}

/**
 * Guarda o que cada guild pediu e resolve o conflito a cada mudança. É uma
 * classe, e não um `Math.min` no `ready`, porque uma guild pode entrar depois
 * do boot — o registro aprova a qualquer momento: sem memória do que as outras
 * pediram, preparar a nova mudaria o intervalo de todas.
 */
export class ProcessTuner {
  private readonly perGuild = new Map<string, ProcessTuning>();

  record(guildId: string, tuning: ProcessTuning): void {
    this.perGuild.set(guildId, tuning);
  }

  forget(guildId: string): void {
    this.perGuild.delete(guildId);
  }

  /** Aplica o resultado no serviço do processo. Sem guild, não mexe. */
  apply(ctx: BotContext): void {
    const tunings = [...this.perGuild.values()];
    if (tunings.length === 0) return;
    ctx.stats.setFlushInterval(Math.min(...tunings.map((t) => t.flushSeconds)));
  }
}

/**
 * Instância única do processo: o `ready` e o `guildCreate` alimentam o mesmo
 * tuner, e é a soma dos dois que decide os valores.
 */
export const processTuner = new ProcessTuner();

/**
 * Deixa uma guild pronta para ser atendida: linha em `guilds`, config aquecida
 * e slash commands registrados. Roda no `ready` para cada guild atendida e no
 * `guildCreate` de quem já entra atendido (demo).
 */
export async function prepareGuild(ctx: BotContext, guild: Guild): Promise<ProcessTuning> {
  await upsertGuild(ctx, guild);

  // Aqui havia um `guild.members.fetch()` — o servidor inteiro para o cache, a
  // cada boot. Ele saiu porque a RAM crescia com a **soma** dos membros de
  // todos os servidores, e com servidores de terceiros isso estoura os 384 MB
  // do container antes de qualquer outra coisa dar sinal.
  //
  // O cache agora se enche sozinho pelos eventos (quem fala, quem entra, quem
  // é punido) e tem teto por guild (`MEMBER_CACHE_MAX`). Quem precisa de um
  // membro específico usa `fetchMember`; quem precisa da lista pergunta ao
  // gateway (`searchMembers`), que é o que o próprio cliente do Discord faz.

  // Aquece o cache de config antes de aceitar interações.
  await ctx.config.warm(guild.id);

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

  return { flushSeconds: statsConfig.flushIntervalSeconds };
}
