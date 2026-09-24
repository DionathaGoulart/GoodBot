import { getLfgSession, listDueLfgSessions, updateLfgSession } from '@goodbot/db';
import {
  freeSlots,
  HOUR_MS,
  LFG_CALL_MINUTES,
  LFG_REMINDER_MINUTES,
  LFG_ROOM_HOLD_MINUTES,
  LFG_SESSION_HOURS,
  MINUTE_MS,
  seatedEntries,
} from '@goodbot/shared';
import { ChannelType } from 'discord.js';

import { messageLink } from './agenda';
import { occupantsOf } from './rooms';
import { childLogger } from '../../logger';

import type { SquadAgendaService } from './agenda';
import type { SquadRoomService } from './rooms';
import type { AuditService } from '../audit';
import type { ConfigService } from '../config';
import type { RegistryService } from '../registry';
import type { Db, LfgSession } from '@goodbot/db';
import type { Roster, SquadsConfig } from '@goodbot/shared';
import type { Client, Guild, VoiceChannel } from 'discord.js';

const log = childLogger('squads');

/** De quanto em quanto tempo o relógio da agenda olha o banco. */
export const AGENDA_TICK_MS = MINUTE_MS;

const REMINDER_MS = LFG_REMINDER_MINUTES * MINUTE_MS;
const CALL_MS = LFG_CALL_MINUTES * MINUTE_MS;
const HOLD_MS = LFG_ROOM_HOLD_MINUTES * MINUTE_MS;
const SESSION_MS = LFG_SESSION_HOURS * HOUR_MS;

// ── Regras puras ────────────────────────────────────────────────────────────

/**
 * A sala da jogatina vista pelo relógio: `none` quando ela nunca existiu (sem
 * categoria, sem permissão), `gone` quando existiu e sumiu.
 */
export type RoomState = 'none' | 'gone' | 'empty' | 'occupied';

/**
 * O que o relógio faz com uma jogatina: `remind` na thread, `call` no canal do
 * painel, `start` abre a sala, `lonely` fecha quem ninguém confirmou além do
 * host e `end` fecha a que rolou (ou a que o bot perdeu por estar fora do ar).
 */
export type AgendaStep = 'remind' | 'call' | 'start' | 'lonely' | 'end';

export type ClockSession = Pick<
  LfgSession,
  'status' | 'startsAt' | 'createdAt' | 'remindedAt' | 'calledAt' | 'startedAt'
>;

/**
 * Os passos vencidos de uma jogatina em `now`. Cada um tem a sua coluna
 * (`remindedAt`, `calledAt`, `startedAt`, `endedAt`), então rodar de novo
 * depois de gravar não repete nada.
 */
export function agendaSteps(
  session: ClockSession,
  roster: Roster,
  now: number,
  room: RoomState,
): AgendaStep[] {
  const startsAt = session.startsAt.getTime();
  if (session.status === 'live') {
    const since = session.startedAt?.getTime() ?? startsAt;
    if (now >= since + SESSION_MS || room === 'gone') return ['end'];
    if (room === 'empty' && now >= since + HOLD_MS) return ['end'];
    return [];
  }
  if (session.status !== 'scheduled') return [];
  // O bot ficou fora do ar a jogatina inteira: fecha sem abrir sala.
  if (now >= startsAt + SESSION_MS) return ['end'];
  if (now >= startsAt) return seatedEntries(roster).length > 1 ? ['start'] : ['lonely'];

  const steps: AgendaStep[] = [];
  if (
    session.calledAt === null &&
    roster.visibility === 'open' &&
    freeSlots(roster) > 0 &&
    now >= startsAt - CALL_MS
  ) {
    steps.push('call');
  }
  // Marcada já dentro da janela do lembrete: quem entrou acabou de ver a hora.
  if (
    session.remindedAt === null &&
    now >= startsAt - REMINDER_MS &&
    session.createdAt.getTime() < startsAt - REMINDER_MS
  ) {
    steps.push('remind');
  }
  return steps;
}

function unix(at: Date): string {
  return String(Math.floor(at.getTime() / 1000));
}

function mentions(userIds: readonly string[]): string {
  return userIds.map((id) => `<@${id}>`).join(' ');
}

// ── O relógio ───────────────────────────────────────────────────────────────

export interface SquadAgendaClockDeps {
  client: Client;
  db: Db;
  config: Pick<ConfigService, 'get'>;
  registry: Pick<RegistryService, 'servedGuildIds'>;
  audit: Pick<AuditService, 'record'>;
  agenda: Pick<SquadAgendaService, 'refresh'>;
  rooms: Pick<SquadRoomService, 'openSessionRoom'>;
  /** A agenda mudou (jogatina começou ou acabou): o painel se refaz. */
  onChange: (guildId: string) => void;
  now?: () => number;
  tickMs?: number;
}

/**
 * O relógio da agenda (PRD §5.11): a cada minuto lê do banco as jogatinas que
 * começam na próxima hora ou estão rolando e faz o passo vencido de cada uma.
 * O estado todo está nas colunas da jogatina, então um restart só atrasa.
 */
export class SquadAgendaClock {
  private readonly client: Client;
  private readonly db: Db;
  private readonly config: Pick<ConfigService, 'get'>;
  private readonly registry: Pick<RegistryService, 'servedGuildIds'>;
  private readonly audit: Pick<AuditService, 'record'>;
  private readonly agenda: Pick<SquadAgendaService, 'refresh'>;
  private readonly rooms: Pick<SquadRoomService, 'openSessionRoom'>;
  private readonly onChange: (guildId: string) => void;
  private readonly now: () => number;
  private readonly tickMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(deps: SquadAgendaClockDeps) {
    this.client = deps.client;
    this.db = deps.db;
    this.config = deps.config;
    this.registry = deps.registry;
    this.audit = deps.audit;
    this.agenda = deps.agenda;
    this.rooms = deps.rooms;
    this.onChange = deps.onChange;
    this.now = deps.now ?? Date.now;
    this.tickMs = deps.tickMs ?? AGENDA_TICK_MS;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Uma volta. Nunca lança: jogatina que falha vai para o log e a próxima segue. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = this.now();
      const served = new Set(this.registry.servedGuildIds());
      const due = await listDueLfgSessions(this.db, new Date(now + CALL_MS));
      for (const session of due) {
        if (!served.has(session.guildId)) continue;
        try {
          await this.advance(session.guildId, session.id, now);
        } catch (error) {
          log.warn(
            { err: error, guildId: session.guildId, sessionId: session.id },
            'relógio da agenda falhou numa jogatina',
          );
        }
      }
    } catch (error) {
      log.warn({ err: error }, 'relógio da agenda falhou');
    } finally {
      this.running = false;
    }
  }

  private async advance(guildId: string, sessionId: string, now: number): Promise<void> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return;
    const config = await this.config.get(guildId, 'squads');
    // Módulo desligado: a agenda para onde está e volta a andar quando ligar.
    if (!config.enabled) return;
    const found = await getLfgSession(this.db, guildId, sessionId);
    if (!found) return;
    const { session, roster } = found;

    for (const step of agendaSteps(session, roster, now, this.roomState(guild, session))) {
      if (step === 'remind') await this.remind(guild, session, roster, now);
      else if (step === 'call') await this.call(guild, config, session, roster, now);
      else if (step === 'start') await this.begin(guild, config, session, roster, now);
      else await this.finish(guild, session, now, step === 'lonely');
    }
  }

  private roomState(guild: Guild, session: LfgSession): RoomState {
    if (!session.roomId) return 'none';
    if (!guild.channels.cache.has(session.roomId)) return 'gone';
    return occupantsOf(guild, session.roomId) > 0 ? 'occupied' : 'empty';
  }

  /** A thread da jogatina, ou `null` sem ela: o aviso some e o passo conta como feito. */
  private async postInThread(
    guild: Guild,
    session: LfgSession,
    content: string,
    users: readonly string[],
  ): Promise<void> {
    const thread = session.threadId ? guild.channels.cache.get(session.threadId) : undefined;
    if (!thread?.isThread()) {
      log.info({ guildId: guild.id, sessionId: session.id }, 'jogatina sem thread; aviso perdido');
      return;
    }
    try {
      await thread.send({ content, allowedMentions: { users: [...users] } });
    } catch (error) {
      log.warn({ err: error, guildId: guild.id, sessionId: session.id }, 'aviso na thread falhou');
    }
  }

  /** 30 min antes: marca quem vai na thread. */
  private async remind(guild: Guild, session: LfgSession, roster: Roster, now: number) {
    const claimed = await updateLfgSession(this.db, guild.id, session.id, {
      remindedAt: new Date(now),
    });
    if (!claimed) return;
    const seated = seatedEntries(roster).map((entry) => entry.userId);
    const at = unix(session.startsAt);
    await this.postInThread(
      guild,
      session,
      `${mentions(seated)} a jogatina começa <t:${at}:R>, às <t:${at}:t>.`,
      seated,
    );
  }

  /**
   * 1 h antes, aberta e com vaga: chama reforço no canal do painel, marcando o
   * cargo de busca. Sem canal ou sem link o passo conta como feito, para não
   * tentar de novo a cada minuto.
   */
  private async call(
    guild: Guild,
    config: SquadsConfig,
    session: LfgSession,
    roster: Roster,
    now: number,
  ): Promise<void> {
    const claimed = await updateLfgSession(this.db, guild.id, session.id, {
      calledAt: new Date(now),
    });
    if (!claimed) return;
    const channel = config.panelChannelId
      ? guild.channels.cache.get(config.panelChannelId)
      : undefined;
    if (channel?.type !== ChannelType.GuildText || !session.channelId || !session.messageId) {
      log.info({ guildId: guild.id, sessionId: session.id }, 'chamada de reforço sem canal');
      return;
    }
    const role = config.searchRoleId ? guild.roles.cache.get(config.searchRoleId) : undefined;
    const free = freeSlots(roster);
    const at = unix(session.startsAt);
    const link = messageLink(guild.id, session.channelId, session.messageId);
    const vagas = free === 1 ? '1 vaga' : `${String(free)} vagas`;
    try {
      await channel.send({
        content:
          `${role ? `${role.toString()} ` : ''}jogatina <t:${at}:R>, às <t:${at}:t>, ` +
          `com **${vagas}**. Clique em VOU na mensagem: ${link}`,
        allowedMentions: { roles: role ? [role.id] : [] },
      });
    } catch (error) {
      log.warn(
        { err: error, guildId: guild.id, sessionId: session.id },
        'chamada de reforço falhou',
      );
    }
  }

  /**
   * A hora chegou: abre a sala, posta o link na thread e puxa para ela quem vai
   * e já está em voz. A linha vira `live` antes de tudo, então uma sala que não
   * nasce não trava a jogatina: ela roda sem sala e fecha pelo teto de horas.
   */
  private async begin(
    guild: Guild,
    config: SquadsConfig,
    session: LfgSession,
    roster: Roster,
    now: number,
  ): Promise<void> {
    const claimed = await updateLfgSession(this.db, guild.id, session.id, {
      status: 'live',
      startedAt: new Date(now),
    });
    if (!claimed) return;
    const seated = seatedEntries(roster).map((entry) => entry.userId);
    let room: VoiceChannel | null = null;
    try {
      room = await this.rooms.openSessionRoom(guild, config, {
        slots: roster.slots,
        members: roster.visibility === 'closed' ? seated : null,
        until: now + HOLD_MS,
      });
    } catch (error) {
      log.warn({ err: error, guildId: guild.id, sessionId: session.id }, 'sala da jogatina falhou');
    }
    if (room) await updateLfgSession(this.db, guild.id, session.id, { roomId: room.id });

    await this.postInThread(
      guild,
      session,
      room
        ? `${mentions(seated)} a jogatina começou: ${room.toString()}`
        : `${mentions(seated)} a jogatina começou. Não consegui abrir a sala: se encontrem em voz.`,
      seated,
    );
    if (room) await this.pullIn(guild, room, seated);

    this.audit.record({
      guildId: guild.id,
      action: 'squad.session.start',
      source: 'job',
      target: { type: 'lfg_session', id: session.id },
      after: { roomId: room?.id ?? null, seated: seated.length },
    });
    await this.agenda.refresh(guild.id, session.id);
    this.onChange(guild.id);
  }

  /** Quem vai e já está em voz (fora o AFK) é movido para a sala. */
  private async pullIn(guild: Guild, room: VoiceChannel, userIds: readonly string[]) {
    for (const userId of userIds) {
      const state = guild.voiceStates.cache.get(userId);
      if (!state?.channelId || state.channelId === room.id) continue;
      if (state.channelId === guild.afkChannelId) continue;
      try {
        await state.setChannel(room, 'Jogatina da agenda começou');
      } catch (error) {
        log.debug({ err: error, guildId: guild.id, userId }, 'não movi para a sala da jogatina');
      }
    }
  }

  /** Fecha a jogatina: a mensagem vira "rolou" sem botões. A sala segue a vida dela. */
  private async finish(guild: Guild, session: LfgSession, now: number, lonely: boolean) {
    const closed = await updateLfgSession(this.db, guild.id, session.id, {
      status: 'done',
      endedAt: new Date(now),
    });
    if (!closed) return;
    if (lonely) {
      await this.postInThread(
        guild,
        session,
        'Ninguém confirmou além de quem marcou, então a jogatina fechou sem abrir sala.',
        [],
      );
    }
    this.audit.record({
      guildId: guild.id,
      action: 'squad.session.end',
      source: 'job',
      target: { type: 'lfg_session', id: session.id },
      after: { lonely },
    });
    await this.agenda.refresh(guild.id, session.id);
    this.onChange(guild.id);
  }
}
