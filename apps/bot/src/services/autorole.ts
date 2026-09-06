import { scheduleAction } from '@cobot/db';
import { MINUTE_MS, SECOND_MS } from '@cobot/shared';

import { childLogger } from '../logger';
import { fetchMember } from './moderation';

import type { ConfigService } from './config';
import type { Db } from '@cobot/db';
import type { AutoroleConfig } from '@cobot/shared';
import type { Guild, GuildMember } from 'discord.js';

const log = childLogger('autorole');

/** Motivo que aparece no audit log do Discord. */
export const AUTOROLE_REASON = 'Autorole';
export const VERIFY_REASON = 'Cargo de verificação';

/**
 * Até aqui o atraso cabe num `setTimeout`; acima disso vai para
 * `scheduled_actions`, que sobrevive a um restart do bot.
 */
export const AUTOROLE_TIMER_MAX_MS = 10 * MINUTE_MS;

/**
 * Cargos que um membro recebe ao entrar. Bot e humano são listas separadas —
 * um bot de música não pode cair no cargo de membro verificado.
 */
export function selectAutoroleIds(config: AutoroleConfig, isBot: boolean): string[] {
  const ids = isBot ? config.botRoleIds : config.humanRoleIds;
  // Ids repetidos no painel viram uma chamada só à API do Discord.
  return [...new Set(ids)];
}

export interface AutoroleDeps {
  db: Db;
  config: ConfigService;
}

/** Autorole na entrada e cargo de verificação por botão (PRD §5.5). */
export class AutoroleService {
  private readonly db: Db;
  private readonly config: ConfigService;
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(deps: AutoroleDeps) {
    this.db = deps.db;
    this.config = deps.config;
  }

  async onJoin(member: GuildMember): Promise<void> {
    const config = await this.config.get(member.guild.id, 'autorole');
    if (!config.enabled) return;
    if (selectAutoroleIds(config, member.user.bot).length === 0) return;

    if (config.delaySeconds === 0) {
      await this.applyTo(member);
      return;
    }

    const delayMs = config.delaySeconds * SECOND_MS;
    if (delayMs <= AUTOROLE_TIMER_MAX_MS) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        void this.applyFor(member.guild, member.id);
      }, delayMs);
      timer.unref();
      this.timers.add(timer);
      return;
    }

    await scheduleAction(this.db, {
      guildId: member.guild.id,
      kind: 'autorole',
      runAt: new Date(Date.now() + delayMs),
      payload: { targetId: member.id },
    });
  }

  /** Usado pelo atraso (timer ou scheduler): o membro pode já ter saído. */
  async applyFor(guild: Guild, userId: string): Promise<void> {
    const member = await fetchMember(guild, userId);
    if (!member) {
      log.debug({ guildId: guild.id, userId }, 'membro saiu antes do autorole');
      return;
    }
    await this.applyTo(member);
  }

  /** Relê a config: entre a entrada e o atraso ela pode ter mudado. */
  private async applyTo(member: GuildMember): Promise<void> {
    const config = await this.config.get(member.guild.id, 'autorole');
    if (!config.enabled) return;

    const roleIds = selectAutoroleIds(config, member.user.bot).filter(
      (id) => !member.roles.cache.has(id),
    );
    if (roleIds.length === 0) return;

    try {
      await member.roles.add(roleIds, AUTOROLE_REASON);
      log.info({ guildId: member.guild.id, userId: member.id, roleIds }, 'autorole aplicado');
    } catch (error) {
      // Cargo acima do bot, cargo apagado ou falta de `ManageRoles`: fica no
      // log, sem quebrar o evento de entrada.
      log.warn({ err: error, guildId: member.guild.id, userId: member.id, roleIds },
        'não foi possível aplicar o autorole');
    }
  }

  /** Cancela os atrasos curtos pendentes no shutdown. */
  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}
