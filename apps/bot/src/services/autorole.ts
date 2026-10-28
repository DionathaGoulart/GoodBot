import { scheduleAction } from '@goodbot/db';
import { SECOND_MS } from '@goodbot/shared';
import { DiscordAPIError } from 'discord.js';

import { childLogger } from '../logger';

import type { AuditService } from './audit';
import type { ConfigService } from './config';
import type { Db } from '@goodbot/db';
import type { AutoroleConfig } from '@goodbot/shared';
import type { Guild, GuildMember } from 'discord.js';

const log = childLogger('autorole');

/** Motivo que aparece no audit log do Discord. */
export const AUTOROLE_REASON = 'Autorole';
export const VERIFY_REASON = 'Cargo de verificação';

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
  /** Trilha de auditoria (§6.5); ausente nos testes. */
  audit?: Pick<AuditService, 'record'>;
}

/** Autorole na entrada e cargo de verificação por botão (PRD §5.5). */
export class AutoroleService {
  private readonly db: Db;
  private readonly config: ConfigService;
  private readonly audit: Pick<AuditService, 'record'> | undefined;

  constructor(deps: AutoroleDeps) {
    this.db = deps.db;
    this.config = deps.config;
    this.audit = deps.audit;
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
    await scheduleAction(this.db, {
      guildId: member.guild.id,
      kind: 'autorole',
      runAt: new Date(Date.now() + delayMs),
      payload: { targetId: member.id },
    });
  }

  /** Atrasos são persistidos; só membro realmente ausente conclui sem aplicar. */
  async applyFor(guild: Guild, userId: string): Promise<void> {
    const member = await guild.members
      .fetch({ user: userId, force: true })
      .catch((error: unknown) => {
        if (error instanceof DiscordAPIError && Number(error.code) === 10007) return null;
        throw error;
      });
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
      // Sem ator: quem deu o cargo foi a regra, e o bot é quem assina.
      this.audit?.record({
        guildId: member.guild.id,
        action: 'autorole.apply',
        source: 'event',
        target: { type: 'member', id: member.id },
        reason: AUTOROLE_REASON,
        after: { roleIds },
      });
    } catch (error) {
      // Cargo acima do bot, cargo apagado ou falta de `ManageRoles`: fica no
      // log, sem quebrar o evento de entrada.
      log.warn(
        { err: error, guildId: member.guild.id, userId: member.id, roleIds },
        'não foi possível aplicar o autorole',
      );
      throw error;
    }
  }
}
