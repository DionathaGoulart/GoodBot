import { UserFacingError } from '@goodbot/shared';
import { ChannelType } from 'discord.js';

import { childLogger } from '../../logger';

import type { AuditEntry, AuditService } from '../audit';
import type { ConfigService } from '../config';
import type { CallService } from './calls';
import type { AdminDmKind } from './embeds';
import type { GuestService } from './guests';
import type { GuideService } from './guide';
import type { HistoryService } from './history';
import type { ManualMatchService } from './manual';
import type { MatcherService } from './matcher';
import type { PlayerAdminService } from './players';
import type { ProfileService } from './profiles';
import type { ProposalService } from './proposals';
import type { JoinRequestService } from './requests';
import type { SearchService } from './search';
import type { SessionService } from './sessions';
import type { SquadLifecycleService } from './squads';
import type { Db, Squad } from '@goodbot/db';
import type { SquadsConfig } from '@goodbot/shared';
import type { BaseMessageOptions, Client, Guild, GuildBasedChannel, TextChannel } from 'discord.js';

export const log = childLogger('squads');

/** "Unknown Member": o Discord confirma que a pessoa não está no servidor. */
const DISCORD_UNKNOWN_MEMBER = 10007;

export interface SquadServiceDeps {
  db: Db;
  client: Client;
  config: ConfigService;
  /** Trilha de auditoria (§6.5); ausente nos testes. */
  audit?: Pick<AuditService, 'record'>;
  /** Relógio do módulo: toda conta de prazo passa por aqui. */
  now?: () => number;
}

/** As partes do módulo; uma chama a outra só por aqui, na hora da chamada. */
export interface SquadParts {
  profiles: ProfileService;
  matcher: MatcherService;
  proposals: ProposalService;
  squads: SquadLifecycleService;
  requests: JoinRequestService;
  sessions: SessionService;
  calls: CallService;
  guests: GuestService;
  history: HistoryService;
  guide: GuideService;
  search: SearchService;
  manual: ManualMatchService;
  players: PlayerAdminService;
}

/**
 * O que toda parte do módulo compartilha: dependências, relógio, leitura do
 * config e os acessos ao Discord que se repetem. As partes se chamam em
 * círculo (sair arquiva, arquivar libera o voice, aceitar um pedido põe o
 * membro, quase tudo atualiza o guia), então cada uma recebe este objeto e
 * alcança as outras por `parts`.
 */
export class SquadContext {
  readonly db: Db;
  readonly client: Client;
  readonly config: ConfigService;
  readonly now: () => number;
  private readonly audit: Pick<AuditService, 'record'> | undefined;
  /** Preenchido pelo `SquadService` logo depois de criar as partes. */
  parts!: SquadParts;

  constructor(deps: SquadServiceDeps) {
    this.db = deps.db;
    this.client = deps.client;
    this.config = deps.config;
    this.audit = deps.audit;
    this.now = deps.now ?? Date.now;
  }

  date(): Date {
    return new Date(this.now());
  }

  /** Config do módulo; lança se ele estiver desligado. */
  async requireConfig(guildId: string): Promise<SquadsConfig> {
    const config = await this.config.get(guildId, 'squads');
    if (!config.enabled) {
      throw new UserFacingError('O módulo de squads está desligado neste servidor.', {
        code: 'MODULE_DISABLED',
      });
    }
    return config;
  }

  async embedColor(guildId: string): Promise<number> {
    return (await this.config.getSettings(guildId)).embedColor;
  }

  /** Fire-and-forget, como o `AuditService`: auditoria nunca impede a ação. */
  record(entry: AuditEntry): void {
    this.audit?.record(entry);
  }

  async fetchChannel(guild: Guild, channelId: string): Promise<GuildBasedChannel | null> {
    const cached = guild.channels.cache.get(channelId);
    if (cached) return cached;
    return guild.channels.fetch(channelId).catch(() => null);
  }

  /** O canal de texto do squad; `null` quando ainda não existe ou foi apagado. */
  async textChannel(
    guild: Guild,
    squad: Pick<Squad, 'textChannelId'>,
  ): Promise<TextChannel | null> {
    if (!squad.textChannelId) return null;
    const channel = await this.fetchChannel(guild, squad.textChannelId);
    return channel?.type === ChannelType.GuildText ? (channel as TextChannel) : null;
  }

  /**
   * A pessoa ainda está no servidor? Cache primeiro, depois o Discord. `false`
   * só com "Unknown Member"; qualquer outra falha é `null` (não se sabe), e
   * quem chama não bloqueia por falha passageira: se ela saiu mesmo, o Discord
   * recusa adiante.
   */
  async isGuildMember(guild: Guild, userId: string): Promise<boolean | null> {
    if (guild.members.cache.has(userId)) return true;
    try {
      await guild.members.fetch({ user: userId });
      return true;
    } catch (error) {
      return discordErrorCode(error) === DISCORD_UNKNOWN_MEMBER ? false : null;
    }
  }

  /**
   * Avisa por DM quem sofreu uma ação de admin pelo painel. Nunca lança: DM
   * fechada, bot bloqueado e pessoa sem servidor em comum são situações
   * normais, e a ação já valeu. Não tenta de novo: repetir DM recusada atrai
   * rate limit. O erro fica fora do log de propósito: o `DiscordAPIError` leva
   * o corpo da requisição, com o texto da DM e o motivo.
   */
  async sendDm(
    userId: string,
    message: BaseMessageOptions,
    bindings: { guildId: string; action: AdminDmKind },
  ): Promise<boolean> {
    try {
      const user = await this.client.users.fetch(userId);
      if (user.bot) return false;
      await user.send(message);
      log.info({ ...bindings, userId }, 'aviso de admin enviado por DM');
      return true;
    } catch (error) {
      log.warn(
        { ...bindings, userId, code: discordErrorCode(error) },
        'não foi possível avisar a pessoa por DM',
      );
      return false;
    }
  }
}

/** Handler de `.catch` que só registra: falha do Discord que não é culpa de quem clicou. */
export function logFailure(message: string, bindings: Record<string, unknown>) {
  return (error: unknown): void => {
    log.warn({ err: error, ...bindings }, message);
  };
}

/** Código numérico de um `DiscordAPIError`; `null` para qualquer outro erro. */
export function discordErrorCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  return typeof error.code === 'number' ? error.code : null;
}

export function firstIssue(issues: readonly { message: string }[], fallback: string): string {
  return issues[0]?.message ?? fallback;
}

/**
 * Espera `task` por até `ms`. `true` se terminou bem a tempo; `false` se
 * falhou ou demorou. Quando demora, a tarefa continua na fila do discord.js
 * (é o caso do rename, limitado a dois por dez minutos) e termina sozinha
 * depois, sem segurar a resposta da interação.
 */
export async function settleWithin(
  task: Promise<unknown>,
  ms: number,
  onError: (error: unknown) => void,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const settled = task.then(
    () => true,
    (error: unknown) => {
      onError(error);
      return false;
    },
  );
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
    timer.unref();
  });
  try {
    return await Promise.race([settled, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
