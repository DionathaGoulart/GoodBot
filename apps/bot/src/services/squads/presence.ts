import {
  HOUR_MS,
  LFG_PROMPT_COOLDOWN_HOURS,
  MINUTE_MS,
  normalizeGameName,
  SECOND_MS,
  UserFacingError,
} from '@goodbot/shared';
import {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} from 'discord.js';

import { squadDmId } from './ids';
import { botFooter, infoEmbed } from '../../lib/embeds';
import { childLogger } from '../../logger';

import type { ConfigService } from '../config';
import type { RegistryService } from '../registry';
import type { SquadsConfig } from '@goodbot/shared';
import type { Activity, Client, Guild, GuildMember, Presence, Role, VoiceState } from 'discord.js';

const log = childLogger('squads');

/** Motivo que aparece no audit log do Discord. */
export const SEARCH_REASON = 'Buscar squad';

/** De quanto em quanto tempo os prazos vencidos são cobrados. */
export const SQUADS_TICK_MS = 15 * SECOND_MS;

export const PROMPT_COOLDOWN_MS = LFG_PROMPT_COOLDOWN_HOURS * HOUR_MS;

/**
 * Uma presença casada com o jogo e barrada (já busca, sala, sem aviso) não é
 * olhada de novo antes disto. O rich presence de um jogo muda de detalhe a
 * cada partida, e sem essa trava cada mudança custaria um `fetch` do membro.
 */
export const PRESENCE_RECHECK_MS = 5 * MINUTE_MS;

/**
 * `true` quando alguém está **jogando** um dos jogos vigiados. Só `Playing`:
 * um status personalizado escrito "Helldivers 2" não é o jogo aberto.
 */
export function matchesGame(
  activities: readonly Pick<Activity, 'type' | 'name'>[],
  gameNames: readonly string[],
): boolean {
  if (gameNames.length === 0) return false;
  const wanted = new Set(gameNames.map(normalizeGameName));
  return activities.some(
    (activity) =>
      activity.type === ActivityType.Playing && wanted.has(normalizeGameName(activity.name)),
  );
}

/**
 * Por que o cargo cai: `ttl` é quem ligou a busca e não entrou em voz no
 * prazo; `left` é quem saiu da voz e a janela de tolerância passou.
 */
export type DeadlineKind = 'ttl' | 'left';

export interface Deadline {
  at: number;
  kind: DeadlineKind;
}

/**
 * Os prazos do cargo `Buscando Squad`, por guild e pessoa. Mora em memória de
 * propósito (PRD §5.11): um restart perde tudo e a reconciliação recomeça a
 * contar do zero.
 */
export class DeadlineBook {
  private readonly byGuild = new Map<string, Map<string, Deadline>>();

  set(guildId: string, userId: string, deadline: Deadline): void {
    let guild = this.byGuild.get(guildId);
    if (!guild) {
      guild = new Map();
      this.byGuild.set(guildId, guild);
    }
    guild.set(userId, deadline);
  }

  get(guildId: string, userId: string): Deadline | undefined {
    return this.byGuild.get(guildId)?.get(userId);
  }

  clear(guildId: string, userId: string): void {
    const guild = this.byGuild.get(guildId);
    if (!guild) return;
    guild.delete(userId);
    if (guild.size === 0) this.byGuild.delete(guildId);
  }

  clearGuild(guildId: string): void {
    this.byGuild.delete(guildId);
  }

  /** Tira do livro e devolve o que venceu até `now`. */
  takeDue(now: number): { guildId: string; userId: string; deadline: Deadline }[] {
    const due: { guildId: string; userId: string; deadline: Deadline }[] = [];
    for (const [guildId, guild] of this.byGuild) {
      for (const [userId, deadline] of guild) {
        if (deadline.at > now) continue;
        due.push({ guildId, userId, deadline });
        guild.delete(userId);
      }
      if (guild.size === 0) this.byGuild.delete(guildId);
    }
    return due;
  }

  get size(): number {
    let total = 0;
    for (const guild of this.byGuild.values()) total += guild.size;
    return total;
  }
}

/**
 * Quem já foi avisado (cooldown de 6 h) e quem já foi olhado e barrado (5
 * min). Memória: um restart zera, e o custo é uma DM a mais (PRD §5.11).
 */
export class PromptGate {
  private readonly prompted = new Map<string, number>();
  private readonly checked = new Map<string, number>();

  /** `true` quando ainda vale olhar a pessoa agora, e marca a olhada. */
  shouldCheck(guildId: string, userId: string, now: number): boolean {
    const key = `${guildId}:${userId}`;
    const promptedAt = this.prompted.get(key);
    if (promptedAt !== undefined && now - promptedAt < PROMPT_COOLDOWN_MS) return false;
    const checkedAt = this.checked.get(key);
    if (checkedAt !== undefined && now - checkedAt < PRESENCE_RECHECK_MS) return false;
    this.checked.set(key, now);
    return true;
  }

  markPrompted(guildId: string, userId: string, now: number): void {
    this.prompted.set(`${guildId}:${userId}`, now);
  }

  /** Esquece o que já venceu, para o mapa não crescer com o servidor. */
  prune(now: number): void {
    for (const [key, at] of this.prompted) {
      if (now - at >= PROMPT_COOLDOWN_MS) this.prompted.delete(key);
    }
    for (const [key, at] of this.checked) {
      if (now - at >= PRESENCE_RECHECK_MS) this.checked.delete(key);
    }
  }
}

/** O canal de voz em que a pessoa está, pelo cache de voz da guild. */
function voiceChannelOf(guild: Guild, userId: string): string | null {
  return guild.voiceStates.cache.get(userId)?.channelId ?? null;
}

function inSquadRoom(guild: Guild, userId: string, config: SquadsConfig): boolean {
  const channelId = voiceChannelOf(guild, userId);
  if (channelId === null) return false;
  if (channelId === config.createChannelId) return true;
  const parentId = guild.channels.cache.get(channelId)?.parentId ?? null;
  return config.categoryId !== null && parentId === config.categoryId;
}

/**
 * O cargo configurado, conferido antes de mexer: existe, não é de integração e
 * está abaixo do cargo do bot. Falta vira erro que diz o que fazer, porque só
 * é chamado onde há alguém esperando resposta.
 */
export function assignableRole(guild: Guild, roleId: string | null, what: string): Role {
  const role = roleId ? guild.roles.cache.get(roleId) : undefined;
  if (!role) {
    throw new UserFacingError(`O cargo ${what} não está configurado. Avise a staff.`, {
      code: 'SQUADS_ROLE_MISSING',
    });
  }
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new UserFacingError('Eu não tenho a permissão **Gerenciar cargos**. Avise a staff.', {
      code: 'MISSING_PERMISSION',
    });
  }
  if (role.managed || role.position >= me.roles.highest.position) {
    throw new UserFacingError(
      `O cargo ${role} está acima do meu. A staff precisa subir o meu cargo na hierarquia.`,
      { code: 'BOT_ROLE_HIERARCHY' },
    );
  }
  return role;
}

export type SearchState = 'on' | 'off';

export interface SquadPresenceDeps {
  client: Client;
  config: Pick<ConfigService, 'get'>;
  registry: Pick<RegistryService, 'servedGuildIds'>;
  now?: () => number;
  tickMs?: number;
}

/**
 * O cargo `Buscando Squad` (PRD §5.11): o aviso automático por DM quando
 * alguém abre o jogo, o toggle manual e os dois jeitos de o cargo cair
 * sozinho (prazo sem entrar em voz e saída da voz depois da janela).
 *
 * Nada aqui vai para o banco. O estado é o cargo no Discord; os prazos e o
 * relógio do aviso vivem em memória e são refeitos pela reconciliação, que
 * roda na primeira vez que o módulo aparece ligado numa guild (o boot, o
 * módulo sendo ligado ou a guild passando a ser atendida).
 */
export class SquadPresenceService {
  private readonly client: Client;
  private readonly config: Pick<ConfigService, 'get'>;
  private readonly registry: Pick<RegistryService, 'servedGuildIds'>;
  private readonly now: () => number;
  private readonly tickMs: number;
  readonly deadlines = new DeadlineBook();
  readonly gate = new PromptGate();
  /** Guilds em que o módulo já foi visto ligado (e reconciliado). */
  private readonly reconciled = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(deps: SquadPresenceDeps) {
    this.client = deps.client;
    this.config = deps.config;
    this.registry = deps.registry;
    this.now = deps.now ?? Date.now;
    this.tickMs = deps.tickMs ?? SQUADS_TICK_MS;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ── Aviso automático ──────────────────────────────────────────────────────

  /**
   * Presença de alguém mudou. Descarta cedo e barato (o evento é o mais
   * frequente do gateway): módulo, jogo e as travas de memória vêm antes de
   * qualquer chamada ao Discord.
   */
  async onPresence(presence: Presence): Promise<void> {
    const guild = presence.guild;
    if (!guild || presence.user?.bot) return;
    const config = await this.config.get(guild.id, 'squads');
    if (!config.enabled || config.searchRoleId === null) return;
    if (!matchesGame(presence.activities, config.gameNames)) return;

    const now = this.now();
    if (!this.gate.shouldCheck(guild.id, presence.userId, now)) return;

    // `force`: o membro que a presença põe no cache nasce sem cargos, e é
    // pelos cargos que a decisão sai.
    let member: GuildMember;
    try {
      member = await guild.members.fetch({ user: presence.userId, force: true });
    } catch {
      return;
    }
    if (member.roles.cache.has(config.searchRoleId)) return;
    if (config.optOutRoleId !== null && member.roles.cache.has(config.optOutRoleId)) return;
    if (inSquadRoom(guild, member.id, config)) return;

    // Marca antes de mandar: DM fechada conta como aviso dado, senão o bot
    // tentaria de novo a cada cinco minutos de jogo.
    this.gate.markPrompted(guild.id, member.id, now);
    try {
      await member.send(promptMessage(guild, config));
      log.debug({ guildId: guild.id, userId: member.id }, 'aviso de squad enviado');
    } catch (error) {
      log.debug({ err: error, guildId: guild.id, userId: member.id }, 'DM de squad recusada');
    }
  }

  // ── Toggles ───────────────────────────────────────────────────────────────

  /** Liga a busca, com o prazo para entrar em voz se a pessoa ainda não está. */
  async startSearch(member: GuildMember, config: SquadsConfig): Promise<void> {
    const role = assignableRole(member.guild, config.searchRoleId, '**Buscando Squad**');
    if (!member.roles.cache.has(role.id)) await member.roles.add(role, SEARCH_REASON);
    if (voiceChannelOf(member.guild, member.id) === null) {
      this.deadlines.set(member.guild.id, member.id, {
        at: this.now() + config.searchTtlMinutes * MINUTE_MS,
        kind: 'ttl',
      });
    } else {
      this.deadlines.clear(member.guild.id, member.id);
    }
  }

  async stopSearch(member: GuildMember, config: SquadsConfig): Promise<void> {
    const role = assignableRole(member.guild, config.searchRoleId, '**Buscando Squad**');
    this.deadlines.clear(member.guild.id, member.id);
    if (member.roles.cache.has(role.id)) await member.roles.remove(role, SEARCH_REASON);
  }

  /** O toggle manual: quem tem o cargo o perde, quem não tem o ganha. */
  async toggleSearch(member: GuildMember, config: SquadsConfig): Promise<SearchState> {
    if (config.searchRoleId !== null && member.roles.cache.has(config.searchRoleId)) {
      await this.stopSearch(member, config);
      return 'off';
    }
    await this.startSearch(member, config);
    return 'on';
  }

  /** `on` = a pessoa agora tem `Sem Aviso de Squad` (não recebe o aviso). */
  async toggleOptOut(member: GuildMember, config: SquadsConfig): Promise<SearchState> {
    const role = assignableRole(member.guild, config.optOutRoleId, '**Sem Aviso de Squad**');
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role, SEARCH_REASON);
      return 'off';
    }
    await member.roles.add(role, SEARCH_REASON);
    return 'on';
  }

  // ── Voz ───────────────────────────────────────────────────────────────────

  /**
   * Entrar em qualquer voz cancela o prazo; sair de todas abre a janela de
   * tolerância. Trocar de canal, mute e stream não mexem em nada.
   */
  async onVoiceState(oldState: VoiceState, newState: VoiceState): Promise<void> {
    if (oldState.channelId === newState.channelId) return;
    const member = newState.member ?? oldState.member;
    if (member?.user.bot) return;
    const guild = newState.guild;
    const config = await this.config.get(guild.id, 'squads');
    if (!config.enabled || config.searchRoleId === null) return;

    if (newState.channelId !== null) {
      this.deadlines.clear(guild.id, newState.id);
      return;
    }
    // O membro do evento de voz vem com os cargos. Sem ele, o prazo entra
    // assim mesmo: quem cobra confere o cargo antes de tirar.
    if (member && !member.roles.cache.has(config.searchRoleId)) return;
    this.deadlines.set(guild.id, newState.id, {
      at: this.now() + config.graceMinutes * MINUTE_MS,
      kind: 'left',
    });
    if (config.graceMinutes === 0) await this.tick();
  }

  // ── Relógio ───────────────────────────────────────────────────────────────

  /** Cobra os prazos vencidos e reconcilia guild em que o módulo acabou de ligar. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = this.now();
      this.gate.prune(now);
      await this.reconcileNewlyEnabled();
      for (const { guildId, userId, deadline } of this.deadlines.takeDue(now)) {
        try {
          await this.expire(guildId, userId, deadline);
        } catch (error) {
          log.warn({ err: error, guildId, userId }, 'não foi possível tirar o cargo de busca');
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async expire(guildId: string, userId: string, deadline: Deadline): Promise<void> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return;
    const config = await this.config.get(guildId, 'squads');
    // Módulo desligado: o bot para de reagir e o cargo fica como está.
    if (!config.enabled || config.searchRoleId === null) return;
    // Rede de segurança para um evento de entrada perdido.
    if (voiceChannelOf(guild, userId) !== null) return;
    const role = guild.roles.cache.get(config.searchRoleId);
    const me = guild.members.me;
    if (!role || !me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      log.warn({ guildId, roleId: config.searchRoleId }, 'cargo de busca inacessível');
      return;
    }
    if (role.position >= me.roles.highest.position) {
      log.warn({ guildId, roleId: role.id }, 'cargo de busca acima do cargo do bot');
      return;
    }
    const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
    if (!member?.roles.cache.has(role.id)) return;
    await member.roles.remove(role, SEARCH_REASON);
    log.debug({ guildId, userId, kind: deadline.kind }, 'cargo de busca caiu');
  }

  private async reconcileNewlyEnabled(): Promise<void> {
    const served = new Set(this.registry.servedGuildIds());
    for (const guildId of this.reconciled) {
      if (!served.has(guildId)) this.forget(guildId);
    }
    for (const guildId of served) {
      const config = await this.config.get(guildId, 'squads');
      if (!config.enabled) {
        if (this.reconciled.has(guildId)) this.forget(guildId);
        continue;
      }
      if (this.reconciled.has(guildId)) continue;
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) continue;
      this.reconciled.add(guildId);
      try {
        await this.reconcile(guild, config);
      } catch (error) {
        log.warn({ err: error, guildId }, 'reconciliação do cargo de busca falhou');
      }
    }
  }

  private forget(guildId: string): void {
    this.reconciled.delete(guildId);
    this.deadlines.clearGuild(guildId);
  }

  /**
   * Quem tem `Buscando Squad` e não está em voz ganha a janela de tolerância
   * contada do zero. A lista vem paginada pela REST sem encher o cache: o
   * cache de membros tem teto e `role.members` só enxerga o que está nele.
   */
  async reconcile(guild: Guild, config: SquadsConfig): Promise<number> {
    const roleId = config.searchRoleId;
    if (roleId === null) return 0;
    const at = this.now() + config.graceMinutes * MINUTE_MS;
    let after: string | undefined;
    let scheduled = 0;
    for (;;) {
      const page = await guild.members.list({
        limit: 1000,
        cache: false,
        ...(after ? { after } : {}),
      });
      for (const member of page.values()) {
        if (!member.roles.cache.has(roleId)) continue;
        if (voiceChannelOf(guild, member.id) !== null) continue;
        // Quem ligou a busca depois do boot já tem o seu prazo, e ele vale.
        if (this.deadlines.get(guild.id, member.id)) continue;
        this.deadlines.set(guild.id, member.id, { at, kind: 'left' });
        scheduled += 1;
      }
      if (page.size < 1000) break;
      after = page.lastKey();
      if (after === undefined) break;
    }
    if (scheduled > 0) log.info({ guildId: guild.id, scheduled }, 'buscas reconciliadas');
    return scheduled;
  }
}

/** A DM do aviso automático, com os três botões. */
export function promptMessage(guild: Pick<Guild, 'id' | 'name'>, config: SquadsConfig) {
  const embed = infoEmbed({
    title: 'Buscar squad?',
    description:
      `Vi que você abriu o jogo. Quer que o pessoal de **${guild.name}** saiba que você ` +
      'está procurando squad agora?\n\n' +
      `Você ganha o cargo **Buscando Squad** e ele cai sozinho quando você sai da voz, ` +
      `ou em ${String(config.searchTtlMinutes)} minutos se não entrar em nenhuma.`,
    footer: botFooter(),
  });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(squadDmId('search', guild.id))
      .setLabel('BUSCAR SQUAD')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(squadDmId('later', guild.id))
      .setLabel('AGORA NÃO')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(squadDmId('optout', guild.id))
      .setLabel('NÃO AVISAR MAIS')
      .setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}
