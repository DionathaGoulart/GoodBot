import { GREEK_ROOM_NAMES, MAX_GUILD_CHANNELS, MINUTE_MS } from '@goodbot/shared';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

import { DeadlineBook, SQUADS_TICK_MS } from './presence';
import { childLogger } from '../../logger';

import type { SquadPanelService } from './panel';
import type { ConfigService } from '../config';
import type { RegistryService } from '../registry';
import type { SquadsConfig } from '@goodbot/shared';
import type {
  CategoryChannel,
  Client,
  Guild,
  GuildMember,
  VoiceChannel,
  VoiceState,
} from 'discord.js';

const log = childLogger('squads');

/** Motivo que aparece no audit log do Discord. */
export const ROOM_REASON = 'Sala de squad';
export const SESSION_ROOM_REASON = 'Sala de jogatina da agenda';

/**
 * O que o bot precisa na categoria para a sala nascer e receber quem entrou no
 * canal de criar. Falta qualquer uma: não cria e não move (PRD §5.11).
 */
const ROOM_PERMISSIONS = [
  ['ViewChannel', PermissionFlagsBits.ViewChannel],
  ['ManageChannels', PermissionFlagsBits.ManageChannels],
  ['Connect', PermissionFlagsBits.Connect],
  ['MoveMembers', PermissionFlagsBits.MoveMembers],
] as const;

/** `Squad <nome>` → posição no alfabeto grego. É assim que o bot reconhece as suas. */
const ROOM_INDEX = new Map<string, number>(
  GREEK_ROOM_NAMES.map((name, index) => [roomChannelName(name), index]),
);

export function roomChannelName(name: string): string {
  return `Squad ${name}`;
}

/** Posição da sala no alfabeto grego, ou `null` quando o nome não é de sala. */
export function roomIndex(channelName: string): number | null {
  return ROOM_INDEX.get(channelName) ?? null;
}

/** O primeiro nome livre na ordem do alfabeto grego, ou `null` com os 24 em uso. */
export function nextRoomName(usedChannelNames: Iterable<string>): string | null {
  const used = new Set(usedChannelNames);
  return GREEK_ROOM_NAMES.find((name) => !used.has(roomChannelName(name))) ?? null;
}

/**
 * Sala do módulo: voz na `categoryId`, com nome do pool e que não é o canal de
 * criar. Sem tabela, é só isso que separa o que o bot pode apagar.
 */
export function isSquadRoom(
  channel: { id: string; type: ChannelType; parentId: string | null; name: string },
  config: Pick<SquadsConfig, 'categoryId' | 'createChannelId'>,
): boolean {
  return (
    channel.type === ChannelType.GuildVoice &&
    config.categoryId !== null &&
    channel.parentId === config.categoryId &&
    channel.id !== config.createChannelId &&
    roomIndex(channel.name) !== null
  );
}

/**
 * Quem está no canal, pelo cache de voz da guild. `channel.members` passa pelo
 * cache de membros, que tem teto; o de voz vem inteiro do gateway.
 */
export function occupantsOf(guild: Guild, channelId: string): number {
  let count = 0;
  for (const state of guild.voiceStates.cache.values()) {
    if (state.channelId === channelId) count += 1;
  }
  return count;
}

/** As salas do módulo que existem agora, na ordem do alfabeto grego. */
export function listRooms(guild: Guild, config: SquadsConfig): VoiceChannel[] {
  const rooms: VoiceChannel[] = [];
  for (const channel of guild.channels.cache.values()) {
    if (isSquadRoom(channel, config)) rooms.push(channel as VoiceChannel);
  }
  return rooms.sort((a, b) => (roomIndex(a.name) ?? 0) - (roomIndex(b.name) ?? 0));
}

export interface SquadRoomDeps {
  client: Client;
  config: Pick<ConfigService, 'get'>;
  registry: Pick<RegistryService, 'servedGuildIds'>;
  panel: Pick<SquadPanelService, 'schedule' | 'refresh'>;
  now?: () => number;
  tickMs?: number;
}

/**
 * As salas de voz efêmeras (PRD §5.11): quem entra no `➕ Criar Squad` ganha
 * uma sala nova e é movido para ela; a sala que esvazia some depois da janela
 * de tolerância. Cada mudança numa sala pede ao painel uma edição coalescida.
 *
 * Nada vai para o banco: a lista de salas é a categoria no Discord, e o prazo
 * de quem esvaziou é memória, refeita pela reconciliação na primeira vez que o
 * módulo aparece ligado numa guild.
 */
export class SquadRoomService {
  private readonly client: Client;
  private readonly config: Pick<ConfigService, 'get'>;
  private readonly registry: Pick<RegistryService, 'servedGuildIds'>;
  private readonly panel: Pick<SquadPanelService, 'schedule' | 'refresh'>;
  private readonly now: () => number;
  private readonly tickMs: number;
  /** Sala vazia → quando ela some. */
  readonly emptyRooms = new DeadlineBook<{ at: number }>();
  /** Sala de jogatina → até quando ela fica de pé vazia. */
  readonly reservations = new DeadlineBook<{ at: number }>();
  private readonly reconciled = new Set<string>();
  /**
   * Uma criação por vez em cada guild: o nome livre sai do cache de canais, e
   * duas pessoas entrando juntas no canal de criar pegariam o mesmo.
   */
  private readonly queues = new Map<string, Promise<unknown>>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(deps: SquadRoomDeps) {
    this.client = deps.client;
    this.config = deps.config;
    this.registry = deps.registry;
    this.panel = deps.panel;
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

  // ── Voz ───────────────────────────────────────────────────────────────────

  /**
   * Entrar no canal de criar abre uma sala; entrar numa sala cancela o prazo
   * dela; a última pessoa saindo abre a janela. Mute e stream não mexem.
   */
  async onVoiceState(oldState: VoiceState, newState: VoiceState): Promise<void> {
    if (oldState.channelId === newState.channelId) return;
    const guild = newState.guild;
    const config = await this.config.get(guild.id, 'squads');
    if (!config.enabled || config.categoryId === null) return;

    let touched = false;
    let emptied = false;
    if (oldState.channelId !== null) {
      const left = guild.channels.cache.get(oldState.channelId);
      if (left && isSquadRoom(left, config)) {
        touched = true;
        if (occupantsOf(guild, left.id) === 0) {
          this.emptyRooms.set(guild.id, left.id, {
            at: this.emptyDeadline(guild.id, left.id, config),
          });
          emptied = true;
        }
      }
    }
    if (newState.channelId !== null) {
      const joined = guild.channels.cache.get(newState.channelId);
      if (joined && isSquadRoom(joined, config)) {
        touched = true;
        this.emptyRooms.clear(guild.id, joined.id);
      }
      const member = newState.member;
      if (newState.channelId === config.createChannelId && member && !member.user.bot) {
        await this.enqueue(guild.id, () => this.createRoomFor(guild, member, config));
      }
    }
    if (touched) this.panel.schedule(guild.id);
    if (emptied && config.graceMinutes === 0) await this.tick();
  }

  private enqueue<T>(guildId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(guildId) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.catch(() => undefined);
    this.queues.set(guildId, settled);
    void settled.then(() => {
      if (this.queues.get(guildId) === settled) this.queues.delete(guildId);
    });
    return next;
  }

  /**
   * A categoria e o próximo nome livre, ou `null` quando a sala não pode nascer
   * (categoria inválida, permissão faltando, teto de canais, 24 nomes em uso).
   * Sem interação esperando, a falta só vai para o log.
   */
  private roomSlot(
    guild: Guild,
    config: SquadsConfig,
  ): { category: CategoryChannel; name: string } | null {
    const category = config.categoryId ? guild.channels.cache.get(config.categoryId) : undefined;
    if (category?.type !== ChannelType.GuildCategory) {
      log.warn(
        { guildId: guild.id, categoryId: config.categoryId },
        'categoria das salas inválida',
      );
      return null;
    }
    const me = guild.members.me;
    const permissions = me ? (category as CategoryChannel).permissionsFor(me) : null;
    const missing = ROOM_PERMISSIONS.filter(([, flag]) => !permissions?.has(flag)).map(
      ([name]) => name,
    );
    if (missing.length > 0) {
      log.warn({ guildId: guild.id, missing }, 'sem permissão para abrir sala de squad');
      return null;
    }
    if (guild.channels.cache.size >= MAX_GUILD_CHANNELS) {
      log.warn({ guildId: guild.id }, 'servidor no teto de canais; sala de squad não criada');
      return null;
    }
    const inCategory = [...guild.channels.cache.values()]
      .filter((channel) => channel.parentId === category.id)
      .map((channel) => channel.name);
    const name = nextRoomName(inCategory);
    if (name === null) {
      log.warn({ guildId: guild.id }, 'os 24 nomes de sala estão em uso');
      return null;
    }
    return { category: category as CategoryChannel, name };
  }

  /**
   * Cria a sala e move a pessoa. Tudo é conferido antes: uma sala que nasce sem
   * poder receber ninguém é pior que nenhuma.
   */
  async createRoomFor(guild: Guild, member: GuildMember, config: SquadsConfig): Promise<void> {
    // A pessoa pode ter saído enquanto esperava a vez na fila.
    if (guild.voiceStates.cache.get(member.id)?.channelId !== config.createChannelId) return;
    const slot = this.roomSlot(guild, config);
    if (!slot) return;

    // Sem `permissionOverwrites`: o Discord cria a sala sincronizada com a
    // categoria, que é quem manda em quem vê e entra.
    const room = await guild.channels.create({
      name: roomChannelName(slot.name),
      type: ChannelType.GuildVoice,
      parent: slot.category.id,
      userLimit: config.roomSize,
      reason: ROOM_REASON,
    });
    try {
      await member.voice.setChannel(room, ROOM_REASON);
      log.debug(
        { guildId: guild.id, channelId: room.id, userId: member.id },
        'sala de squad aberta',
      );
    } catch (error) {
      // Saiu da voz no meio do caminho, ou o Discord recusou: a sala vazia
      // não fica para trás esperando a janela.
      log.debug({ err: error, guildId: guild.id, channelId: room.id }, 'não movi para a sala');
      await room.delete(ROOM_REASON).catch((deleteError: unknown) => {
        log.warn({ err: deleteError, guildId: guild.id, channelId: room.id }, 'sala órfã ficou');
      });
    }
  }

  /**
   * A sala de uma jogatina da agenda: nasce vazia, com `userLimit` nas vagas, e
   * fica reservada até `until` (não some vazia antes disso). Fechada, só quem
   * vai conecta; sem `ManageRoles` na categoria a sala fica aberta e o motivo
   * vai para o log, porque sala aberta ainda é melhor que nenhuma.
   */
  openSessionRoom(
    guild: Guild,
    config: SquadsConfig,
    options: { slots: number; members: readonly string[] | null; until: number },
  ): Promise<VoiceChannel | null> {
    return this.enqueue(guild.id, async () => {
      const slot = this.roomSlot(guild, config);
      if (!slot) return null;
      const room = await guild.channels.create({
        name: roomChannelName(slot.name),
        type: ChannelType.GuildVoice,
        parent: slot.category.id,
        userLimit: options.slots,
        reason: SESSION_ROOM_REASON,
      });
      this.reserve(guild.id, room.id, options.until);
      if (options.members) await this.restrict(guild, slot.category, room, options.members);
      this.panel.schedule(guild.id);
      return room;
    });
  }

  /** Fecha a sala a quem vai: o bot primeiro, senão ele mesmo perde o acesso. */
  private async restrict(
    guild: Guild,
    category: CategoryChannel,
    room: VoiceChannel,
    members: readonly string[],
  ): Promise<void> {
    const me = guild.members.me;
    if (!me || !category.permissionsFor(me).has(PermissionFlagsBits.ManageRoles)) {
      log.warn(
        { guildId: guild.id, channelId: room.id },
        'sem ManageRoles: sala da jogatina fechada nasceu aberta',
      );
      return;
    }
    try {
      await room.permissionOverwrites.edit(
        me.id,
        { ViewChannel: true, Connect: true, MoveMembers: true, ManageChannels: true },
        { reason: SESSION_ROOM_REASON },
      );
      for (const userId of members) {
        await room.permissionOverwrites.edit(
          userId,
          { Connect: true },
          { reason: SESSION_ROOM_REASON },
        );
      }
      await room.permissionOverwrites.edit(
        guild.id,
        { Connect: false },
        { reason: SESSION_ROOM_REASON },
      );
    } catch (error) {
      log.warn(
        { err: error, guildId: guild.id, channelId: room.id },
        'sala da jogatina fechada nasceu aberta',
      );
    }
  }

  /**
   * Segura a sala de pé, vazia, até `until`. Já vazia, o prazo de apagar passa
   * a ser esse; ocupada, a reserva só estica a janela de quando esvaziar.
   */
  reserve(guildId: string, channelId: string, until: number): void {
    this.reservations.set(guildId, channelId, { at: until });
    const guild = this.client.guilds.cache.get(guildId);
    if (guild && occupantsOf(guild, channelId) === 0) {
      this.emptyRooms.set(guildId, channelId, { at: until });
    }
  }

  /** Quando a sala que acabou de esvaziar some: a janela, ou a reserva se for depois. */
  private emptyDeadline(guildId: string, channelId: string, config: SquadsConfig): number {
    const grace = this.now() + config.graceMinutes * MINUTE_MS;
    const reserved = this.reservations.get(guildId, channelId)?.at ?? 0;
    return Math.max(grace, reserved);
  }

  // ── Relógio ───────────────────────────────────────────────────────────────

  /** Apaga as salas cuja janela passou e reconcilia guild em que o módulo acabou de ligar. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.reconcileNewlyEnabled();
      this.reservations.takeDue(this.now());
      for (const { guildId, id } of this.emptyRooms.takeDue(this.now())) {
        try {
          await this.deleteIfEmpty(guildId, id);
        } catch (error) {
          log.warn({ err: error, guildId, channelId: id }, 'não foi possível apagar a sala');
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async deleteIfEmpty(guildId: string, channelId: string): Promise<void> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return;
    const config = await this.config.get(guildId, 'squads');
    // Módulo desligado: o bot para de reagir e a sala fica como está.
    if (!config.enabled) return;
    const channel = guild.channels.cache.get(channelId);
    // Confere de novo: a staff pode ter renomeado ou movido o canal na janela.
    if (!channel || !isSquadRoom(channel, config)) return;
    if (occupantsOf(guild, channelId) > 0) return;
    // Reserva de jogatina que ainda vale: o prazo volta para o fim dela.
    const reserved = this.reservations.get(guildId, channelId);
    if (reserved && reserved.at > this.now()) {
      this.emptyRooms.set(guildId, channelId, { at: reserved.at });
      return;
    }
    const me = guild.members.me;
    if (!me || !channel.permissionsFor(me).has(PermissionFlagsBits.ManageChannels)) {
      log.warn({ guildId, channelId }, 'sem permissão para apagar a sala de squad');
      return;
    }
    await channel.delete(ROOM_REASON);
    log.debug({ guildId, channelId }, 'sala de squad apagada');
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
      this.reconcile(guild, config);
      // O painel se refaz lendo a categoria: a lista é o Discord, nunca cópia.
      await this.panel.refresh(guildId);
    }
  }

  private forget(guildId: string): void {
    this.reconciled.delete(guildId);
    this.emptyRooms.clearGuild(guildId);
    this.reservations.clearGuild(guildId);
  }

  /** Sala vazia na categoria ganha a janela contada do zero. */
  reconcile(guild: Guild, config: SquadsConfig): number {
    let scheduled = 0;
    for (const room of listRooms(guild, config)) {
      if (occupantsOf(guild, room.id) > 0) continue;
      if (this.emptyRooms.get(guild.id, room.id)) continue;
      this.emptyRooms.set(guild.id, room.id, { at: this.emptyDeadline(guild.id, room.id, config) });
      scheduled += 1;
    }
    if (scheduled > 0) log.info({ guildId: guild.id, scheduled }, 'salas vazias reconciliadas');
    return scheduled;
  }
}
