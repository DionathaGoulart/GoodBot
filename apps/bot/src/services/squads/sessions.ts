import {
  cancelSquadSession,
  clearSquadWarned,
  createSquadSession,
  getActiveSessionByVoice,
  getSquad,
  getSquadSession,
  getSquadSessionAt,
  listInactiveSquads,
  listSessionsStartingBetween,
  listSessionsToRelease,
  listSquadMembers,
  listUpcomingSessions,
  markSessionPlayed,
  markSessionReminded,
  markSessionStarted,
  markSquadWarned,
  releaseSessionVoice,
  reopenSquadSession,
  reserveSessionVoice,
  setSessionMessage,
  touchSquadConfirmed,
  voteSquadSession,
} from '@goodbot/db';
import {
  addLocalDays,
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  parseWhen,
  UserFacingError,
  WEEK_MS,
} from '@goodbot/shared';
import { ChannelType } from 'discord.js';

import { currentOverwrites, snapshotOverwrites } from '../../lib/overwrites';
import { isLockable } from '../locks';
import { discordErrorCode, log, logFailure } from './context';
import {
  inactivityWarningMessage,
  sessionMessage,
  sessionReminderMessage,
  sessionStartMessage,
} from './embeds';
import {
  encodeVoiceSnapshot,
  restoreVoiceOverwrites,
  SQUAD_VOICE_REQUIRED_BITS,
  voiceReservationAffectedIds,
  voiceReservationOverwrites,
} from './overwrites';

import type { LockableChannel } from '../locks';
import type { SquadContext } from './context';
import type { SessionState } from './embeds';
import type { Squad, SquadSession } from '@goodbot/db';
import type { AuditSource } from '@goodbot/shared';
import type { Guild, VoiceChannel } from 'discord.js';

/** Depois do aviso de inatividade, quanto o squad tem para responder antes de ser arquivado. */
export const INACTIVITY_GRACE_MS = WEEK_MS;

/**
 * Até onde procurar reservas vivas. A reserva sai no lembrete (no máximo 4 h
 * antes) e é liberada no fim da jogatina (no máximo 12 h depois do início); o
 * que passou disso e ainda não foi liberado cai em `listSessionsToRelease`.
 */
const RESERVATION_LOOKAROUND_MS = 2 * DAY_MS;

/** Quantas semanas o REPETIR pula, no máximo, atrás de uma data que ainda não passou. */
const MAX_REPEAT_WEEKS = 8;

/** `DiscordAPIError` de canal inexistente: o voice foi apagado. */
const DISCORD_UNKNOWN_CHANNEL = 10003;

export interface RemindResult {
  session: SquadSession;
  voiceChannelId: string | null;
}

export interface RemindOptions {
  /**
   * Não manda o lembrete à parte: a jogatina acabou de ser anunciada, e o
   * anúncio já chamou todo mundo.
   */
  quiet?: boolean;
}

export interface StartResult {
  moved: string[];
  pinged: string[];
}

export interface InactivityResult {
  warned: string[];
  archived: string[];
}

/** O que o job tem a fazer com as jogatinas nesta passada. */
export interface DueSessions {
  /** Dentro da antecedência do lembrete, ainda sem lembrete e sem ter acabado. */
  remind: SquadSession[];
  /** Já começaram, sem início marcado e sem ter acabado. */
  start: SquadSession[];
  /** Reserva viva com a jogatina encerrada. */
  release: SquadSession[];
}

export interface ScheduleOptions {
  startsAt: Date;
  /** Quem marcou; precisa ser do squad e já entra como "vou". */
  by: string;
  source: AuditSource;
}

export type ScheduleResult =
  | { outcome: 'created'; session: SquadSession; squad: Squad }
  /** O squad já tinha jogatina nesse minuto: quem pediu virou "vou" nela. */
  | { outcome: 'exists'; session: SquadSession; squad: Squad };

export interface CancelResult {
  outcome: 'cancelled' | 'already';
  session: SquadSession;
}

const isReserved = (session: SquadSession) =>
  session.voiceReservedAt !== null && session.voiceReleasedAt === null;

export function sessionState(session: Pick<SquadSession, 'cancelledAt' | 'startedAt'>): SessionState {
  if (session.cancelledAt) return 'cancelled';
  return session.startedAt ? 'started' : 'scheduled';
}

/**
 * Jogatinas sob demanda. Quem marca é gente (`/bora`, botão BORA, REPETIR);
 * o job de 5 em 5 minutos só lembra, reserva, começa e libera. Cada passo é
 * idempotente: a trava é sempre uma `UPDATE` condicional no banco, antes de
 * qualquer coisa no Discord.
 */
export class SessionService {
  constructor(private readonly ctx: SquadContext) {}

  /** O "quando" digitado, lido no fuso da guild, e a jogatina marcada. */
  async scheduleFromText(
    guild: Guild,
    squadId: string,
    by: string,
    when: string,
    source: AuditSource,
  ): Promise<ScheduleResult> {
    await this.ctx.requireConfig(guild.id);
    const { timezone } = await this.ctx.config.getSettings(guild.id);
    const startsAt = parseWhen(when, this.ctx.date(), timezone);
    return this.schedule(guild, squadId, { startsAt, by, source });
  }

  /**
   * Marca uma jogatina: grava a linha (quem marcou já vai), anuncia no canal
   * chamando o squad e atualiza o guia. Marcada para dentro da antecedência
   * do lembrete (`agora` incluso), já reserva a sala; marcada para agora, já
   * começa e puxa quem está em outro voice.
   */
  async schedule(guild: Guild, squadId: string, options: ScheduleOptions): Promise<ScheduleResult> {
    const { db } = this.ctx;
    const guildId = guild.id;
    const config = await this.ctx.requireConfig(guildId);
    const squad = await this.requireLiveSquad(guildId, squadId);
    const { startsAt, by } = options;
    await this.ctx.parts.squads.assertMember(guildId, squad.id, by, 'marcar jogatina');

    const now = this.ctx.now();
    const endsAt = new Date(startsAt.getTime() + config.sessionHours * HOUR_MS);
    if (endsAt.getTime() <= now) {
      throw new UserFacingError('Esse horário já passou.', { code: 'WHEN_PAST' });
    }

    const existing = await getSquadSessionAt(db, guildId, squad.id, startsAt);
    if (existing && !existing.cancelledAt) return this.joinExisting(guild, squad, existing, by);

    const upcoming = await listUpcomingSessions(db, guildId, new Date(now), {
      squadIds: [squad.id],
    });
    if (upcoming.length >= config.maxUpcomingSessions) {
      throw new UserFacingError(
        `O squad já tem ${String(upcoming.length)} jogatinas marcadas, o máximo neste servidor. Cancele uma antes de marcar outra.`,
        { code: 'SESSION_LIMIT' },
      );
    }

    const input = { endsAt, createdBy: by, goingIds: [by] };
    let session = existing
      ? await reopenSquadSession(db, guildId, existing.id, input)
      : await createSquadSession(db, { guildId, squadId: squad.id, startsAt, ...input });
    if (!session) {
      // Outro `/bora` no mesmo minuto chegou antes, ou a jogatina cancelada
      // ainda segura o voice (a liberação é tentada de novo pelo job).
      const fresh = await getSquadSessionAt(db, guildId, squad.id, startsAt);
      if (fresh && !fresh.cancelledAt) return this.joinExisting(guild, squad, fresh, by);
      throw new UserFacingError(
        'Não consegui marcar nesse horário agora. Tente de novo em alguns minutos.',
        { code: 'SESSION_BUSY' },
      );
    }

    await touchSquadConfirmed(db, guildId, squad.id, this.ctx.date());
    await clearSquadWarned(db, guildId, squad.id);
    this.ctx.record({
      guildId,
      action: 'squad.session.schedule',
      source: options.source,
      actor: by,
      target: { type: 'squad', id: squad.id },
      after: { sessionId: session.id, startsAt: startsAt.toISOString(), reopened: existing !== null },
    });

    session = await this.announce(guild, squad, session);
    if (startsAt.getTime() - now <= config.reminderMinutesBefore * MINUTE_MS) {
      session = (await this.remind(guild, session, { quiet: true }))?.session ?? session;
    }
    if (startsAt.getTime() <= now) {
      await this.start(guild, session);
      session = (await getSquadSession(db, guildId, session.id)) ?? session;
    }
    await this.ctx.parts.guide.refresh(guild, squad.id);
    return { outcome: 'created', session, squad };
  }

  /**
   * CANCELAR: só antes de começar, por quem marcou ou por qualquer membro
   * enquanto ninguém além dele disse "vou" (a jogatina antiga, sem autor,
   * segue só a segunda regra). A sala reservada volta para o pool.
   */
  async cancel(
    guild: Guild,
    sessionId: number,
    by: string,
    source: AuditSource,
  ): Promise<CancelResult> {
    const { db } = this.ctx;
    const guildId = guild.id;
    await this.ctx.requireConfig(guildId);
    const session = await this.requireSession(guildId, sessionId);
    const squad = await this.requireLiveSquad(guildId, session.squadId);
    await this.ctx.parts.squads.assertMember(guildId, squad.id, by, 'cancelar a jogatina');
    if (session.cancelledAt) return { outcome: 'already', session };
    if (session.startedAt) {
      throw new UserFacingError('A jogatina já começou: não dá mais para cancelar.', {
        code: 'SESSION_STARTED',
      });
    }
    const othersGoing = session.goingIds.some((id) => id !== by);
    if (session.createdBy !== by && othersGoing) {
      throw new UserFacingError(
        'Só quem marcou cancela depois que alguém confirmou presença. Se não vai, use NÃO VOU.',
        { code: 'SESSION_NOT_OWNER' },
      );
    }

    const cancelled = await cancelSquadSession(db, guildId, session.id, by, this.ctx.date());
    if (!cancelled) {
      const fresh = (await getSquadSession(db, guildId, session.id)) ?? session;
      if (fresh.cancelledAt) return { outcome: 'already', session: fresh };
      throw new UserFacingError('A jogatina já começou: não dá mais para cancelar.', {
        code: 'SESSION_STARTED',
      });
    }

    this.ctx.record({
      guildId,
      action: 'squad.session.cancel',
      source,
      actor: by,
      target: { type: 'squad', id: squad.id },
      after: { sessionId: cancelled.id, startsAt: cancelled.startsAt.toISOString() },
    });
    if (isReserved(cancelled)) await this.release(guild, cancelled);
    await this.renderSession(guild, cancelled, squad);
    await this.ctx.parts.guide.refresh(guild, squad.id);
    return { outcome: 'cancelled', session: cancelled };
  }

  /**
   * REPETIR: a mesma hora de parede uma semana depois (atravessando horário de
   * verão). Clicado semanas mais tarde, pula para a primeira semana que ainda
   * não passou.
   */
  async repeat(
    guild: Guild,
    sessionId: number,
    by: string,
    source: AuditSource,
  ): Promise<ScheduleResult> {
    await this.ctx.requireConfig(guild.id);
    const session = await this.requireSession(guild.id, sessionId);
    const { timezone } = await this.ctx.config.getSettings(guild.id);
    const now = this.ctx.now();
    let startsAt = addLocalDays(session.startsAt, 7, timezone);
    for (let week = 1; week < MAX_REPEAT_WEEKS && startsAt.getTime() <= now; week++) {
      startsAt = addLocalDays(startsAt, 7, timezone);
    }
    if (startsAt.getTime() <= now) {
      throw new UserFacingError('Essa jogatina é antiga demais para repetir. Use BORA.', {
        code: 'SESSION_TOO_OLD',
      });
    }
    return this.schedule(guild, session.squadId, { startsAt, by, source });
  }

  /**
   * As jogatinas com passo pendente agora. A trava de cada passo continua
   * sendo a `UPDATE` condicional; a lista só evita chamar o Discord à toa.
   * Uma jogatina dura no máximo 12 h, então a busca olha um dia para trás:
   * jogatina que acabou com o bot fora do ar não recebe lembrete nem começa
   * atrasada.
   */
  async due(guildId: string): Promise<DueSessions> {
    const { db } = this.ctx;
    const config = await this.ctx.config.get(guildId, 'squads');
    const now = this.ctx.now();
    const lead = config.reminderMinutesBefore * MINUTE_MS;
    const [upcoming, release] = await Promise.all([
      listSessionsStartingBetween(db, guildId, new Date(now - DAY_MS), new Date(now + lead + 1)),
      listSessionsToRelease(db, guildId, new Date(now)),
    ]);
    const live = upcoming.filter(
      (session) => session.cancelledAt === null && session.endsAt.getTime() > now,
    );
    return {
      remind: live.filter((session) => session.remindedAt === null),
      start: live.filter(
        (session) => session.startedAt === null && session.startsAt.getTime() <= now,
      ),
      release,
    };
  }

  /**
   * Lembrete: reserva a sala e avisa. A reserva vem antes para o aviso já
   * dizer qual é a sala (ou que não há sala). Jogatina sem mensagem (a do
   * agendamento antigo, ou anúncio que falhou) ganha a mensagem completa
   * agora; as outras ganham a sala na mensagem e um lembrete curto à parte.
   * `null` quando o lembrete já tinha saído.
   */
  async remind(
    guild: Guild,
    session: SquadSession,
    options: RemindOptions = {},
  ): Promise<RemindResult | null> {
    const { db } = this.ctx;
    const marked = await markSessionReminded(db, guild.id, session.id, this.ctx.date());
    if (!marked) return null;
    if (marked.cancelledAt) return { session: marked, voiceChannelId: null };

    const squad = await getSquad(db, guild.id, marked.squadId);
    if (!squad || squad.status === 'archived') return { session: marked, voiceChannelId: null };

    const voiceChannelId = await this.reserveVoice(guild, marked);
    const current = (await getSquadSession(db, guild.id, marked.id)) ?? marked;
    if (!current.messageId) {
      return { session: await this.announce(guild, squad, current), voiceChannelId };
    }

    await this.renderSession(guild, current, squad);
    if (!options.quiet) {
      const channel = await this.ctx.textChannel(guild, squad);
      const memberIds = await this.memberIds(guild.id, squad.id);
      const userIds = memberIds.filter((id) => !current.notGoingIds.includes(id));
      if (channel && userIds.length > 0) {
        await channel
          .send(sessionReminderMessage({ userIds, startsAt: current.startsAt, voiceChannelId }))
          .catch(logFailure('falha ao enviar o lembrete', { guildId: guild.id, sessionId: current.id }));
      }
    }
    return { session: current, voiceChannelId };
  }

  /**
   * Reserva um voice do pool para a jogatina: o preferido do squad, se ninguém
   * o segura, ou o primeiro livre. O snapshot dos overwrites é gravado antes
   * de mexer no canal, e é da jogatina (não de `channel_locks`): um `/lock` no
   * mesmo voice não pode trocar o que a liberação restaura. Nunca lança;
   * `null` = sem sala.
   */
  async reserveVoice(guild: Guild, session: SquadSession): Promise<string | null> {
    if (session.voiceReservedAt) return isReserved(session) ? session.voiceChannelId : null;
    if (session.cancelledAt) return null;
    const { db } = this.ctx;
    const guildId = guild.id;
    try {
      const config = await this.ctx.config.get(guildId, 'squads');
      const squad = await getSquad(db, guildId, session.squadId);
      if (!squad || squad.status === 'archived') return null;

      const held = await this.heldVoices(guildId, session.id);
      const preferred =
        squad.voiceChannelId && config.voicePoolIds.includes(squad.voiceChannelId)
          ? [squad.voiceChannelId]
          : [];
      const voiceId = [...preferred, ...config.voicePoolIds].find(
        (id) => !held.has(id) && guild.channels.cache.get(id)?.type === ChannelType.GuildVoice,
      );
      if (!voiceId) {
        log.info({ guildId, sessionId: session.id }, 'pool de voices cheio; jogatina sem sala');
        return null;
      }
      const voice = guild.channels.cache.get(voiceId) as VoiceChannel;

      // O bot não dá nem nega num overwrite o que ele mesmo não tem: sem a
      // checagem, o `set` falharia no meio da jogatina.
      const me = guild.members.me;
      const permissions = me ? voice.permissionsFor(me) : null;
      if (!me || !permissions?.has(SQUAD_VOICE_REQUIRED_BITS)) {
        log.warn(
          {
            guildId,
            voiceId,
            missing: permissions?.missing(SQUAD_VOICE_REQUIRED_BITS) ?? [],
          },
          'reserva de voice pulada: faltam permissões no canal',
        );
        return null;
      }

      const memberIds = await this.memberIds(guildId, squad.id);
      const targets = { everyoneId: guild.roles.everyone.id, botId: me.id, memberIds };
      const affected = voiceReservationAffectedIds(targets);
      const reserved = await reserveSessionVoice(db, guildId, session.id, {
        voiceChannelId: voiceId,
        overwrites: encodeVoiceSnapshot(affected, snapshotOverwrites(voice, affected)),
        at: this.ctx.date(),
      });
      if (!reserved) {
        const current = await getSquadSession(db, guildId, session.id);
        return current && isReserved(current) ? current.voiceChannelId : null;
      }

      try {
        await voice.permissionOverwrites.set(
          voiceReservationOverwrites(currentOverwrites(voice), targets),
          `Jogatina do squad ${squad.name}`,
        );
      } catch (error) {
        log.error(
          { err: error, guildId, voiceId, sessionId: session.id },
          'falha ao reservar o voice',
        );
        await releaseSessionVoice(db, guildId, session.id, this.ctx.date()).catch(() => null);
        return null;
      }

      this.ctx.record({
        guildId,
        action: 'squad.voice.reserve',
        source: 'job',
        target: { type: 'channel', id: voiceId },
        after: { squadId: squad.id, sessionId: session.id, memberIds },
      });
      return voiceId;
    } catch (error) {
      log.error({ err: error, guildId, sessionId: session.id }, 'falha na reserva do voice');
      return null;
    }
  }

  /**
   * Na hora: move para o voice reservado quem já está em outra sala da guild
   * e chama, numa mensagem só, quem não está em voice nenhum. Quem votou
   * "Não vou" fica em paz. Sem sala, dois "vou" já contam como jogatina que
   * rolou. `null` quando a jogatina já tinha começado ou foi cancelada.
   */
  async start(guild: Guild, session: SquadSession): Promise<StartResult | null> {
    const { db } = this.ctx;
    const marked = await markSessionStarted(db, guild.id, session.id, this.ctx.date());
    if (!marked) return null;

    const result: StartResult = { moved: [], pinged: [] };
    const squad = await getSquad(db, guild.id, marked.squadId);
    if (!squad || squad.status === 'archived') return result;

    const voiceId = isReserved(marked) ? marked.voiceChannelId : null;
    for (const userId of await this.memberIds(guild.id, squad.id)) {
      if (marked.notGoingIds.includes(userId)) continue;
      const state = guild.voiceStates.cache.get(userId);
      if (!state?.channelId) {
        result.pinged.push(userId);
        continue;
      }
      if (!voiceId || state.channelId === voiceId) continue;
      try {
        await state.setChannel(voiceId, `Jogatina do squad ${squad.name}`);
        result.moved.push(userId);
      } catch (error) {
        log.warn({ err: error, guildId: guild.id, userId }, 'não foi possível mover para o voice');
      }
    }

    if (!voiceId && marked.goingIds.length >= 2) {
      await markSessionPlayed(db, guild.id, marked.id, this.ctx.date());
    }
    if (result.pinged.length > 0) {
      const channel = await this.ctx.textChannel(guild, squad);
      await channel
        ?.send(sessionStartMessage({ userIds: result.pinged, voiceChannelId: voiceId }))
        .catch(
          logFailure('não foi possível chamar o squad', { guildId: guild.id, squadId: squad.id }),
        );
    }
    await this.renderSession(guild, marked, squad);
    await this.ctx.parts.guide.refresh(guild, squad.id);
    return result;
  }

  /**
   * Libera a reserva: os ids que ela tocou voltam ao snapshot, o resto do
   * canal fica como está. O Discord vem antes do banco: se o restore falha
   * (rate limit, 5xx, 50013 passageiro), a jogatina continua reservada e a
   * próxima passada do job tenta de novo. Marcar antes deixaria o voice do
   * pool com `Connect` negado ao `@everyone` para sempre, porque
   * `listSessionsToRelease` nunca mais devolveria a jogatina.
   *
   * Duas liberações ao mesmo tempo (evento de voz e job) restauram o mesmo
   * snapshot e chegam ao mesmo estado; a `UPDATE` condicional só decide quem
   * registra a auditoria. `false` quando não havia reserva viva, quando outra
   * chamada marcou primeiro ou quando o restore falhou.
   */
  async release(guild: Guild, session: SquadSession): Promise<boolean> {
    const { db } = this.ctx;
    const current = await getSquadSession(db, guild.id, session.id);
    if (!current || !isReserved(current)) return false;
    const { voiceChannelId, voiceOverwrites } = current;
    const bindings = { guildId: guild.id, sessionId: current.id, voiceChannelId };

    let restored = false;
    if (voiceChannelId && voiceOverwrites) {
      const voice = await this.voiceForRelease(guild, voiceChannelId);
      if (voice === 'retry') return false;
      if (voice) {
        try {
          await voice.permissionOverwrites.set(
            restoreVoiceOverwrites(
              currentOverwrites(voice),
              voiceOverwrites,
              guild.roles.everyone.id,
            ),
            'Fim da jogatina do squad',
          );
          restored = true;
        } catch (error) {
          log.warn({ err: error, ...bindings }, 'falha ao liberar o voice; o job tenta de novo');
          return false;
        }
      } else {
        log.info(bindings, 'voice da jogatina não existe mais');
      }
    }

    const released = await releaseSessionVoice(db, guild.id, current.id, this.ctx.date());
    if (!released) return false;
    if (restored && voiceChannelId) {
      this.ctx.record({
        guildId: guild.id,
        action: 'squad.voice.release',
        source: 'job',
        target: { type: 'channel', id: voiceChannelId },
        after: { squadId: released.squadId, sessionId: released.id },
      });
    }
    return true;
  }

  /**
   * O voice a restaurar. `null` quando o canal foi apagado (não há o que
   * restaurar, a reserva pode ser marcada); `'retry'` quando o Discord falhou
   * por outro motivo e não dá para saber se o canal ainda existe.
   */
  private async voiceForRelease(
    guild: Guild,
    voiceChannelId: string,
  ): Promise<LockableChannel | null | 'retry'> {
    const cached = guild.channels.cache.get(voiceChannelId);
    if (cached) return isLockable(cached) ? cached : null;
    try {
      const fetched = await guild.channels.fetch(voiceChannelId);
      return isLockable(fetched) ? fetched : null;
    } catch (error) {
      if (discordErrorCode(error) === DISCORD_UNKNOWN_CHANNEL) return null;
      log.warn(
        { err: error, guildId: guild.id, voiceChannelId },
        'não foi possível buscar o voice da jogatina; o job tenta de novo',
      );
      return 'retry';
    }
  }

  /**
   * Alguém entrou num voice. Se é o voice reservado de uma jogatina viva e a
   * pessoa é do squad, é a prova mais forte de que o squad joga: a jogatina
   * rolou, vale como sinal de vida e desfaz o aviso de inatividade. `true`
   * quando contou.
   */
  async confirmPresence(guild: Guild, voiceChannelId: string, userId: string): Promise<boolean> {
    const { db } = this.ctx;
    const session = await getActiveSessionByVoice(db, guild.id, voiceChannelId, this.ctx.date());
    if (!session || session.cancelledAt) return false;
    const members = await this.memberIds(guild.id, session.squadId);
    if (!members.includes(userId)) return false;
    await markSessionPlayed(db, guild.id, session.id, this.ctx.date());
    await touchSquadConfirmed(db, guild.id, session.squadId, this.ctx.date());
    await clearSquadWarned(db, guild.id, session.squadId);
    return true;
  }

  /**
   * O voice reservado esvaziou. Depois do início da jogatina, a reserva sai
   * antes do fim, para a sala voltar ao servidor; antes do início não, porque
   * o squad ainda está chegando. `true` quando liberou.
   */
  async releaseIfEmpty(guild: Guild, voiceChannelId: string): Promise<boolean> {
    const session = await getActiveSessionByVoice(
      this.ctx.db,
      guild.id,
      voiceChannelId,
      this.ctx.date(),
    );
    if (!session || session.startsAt.getTime() > this.ctx.now()) return false;
    const voice = guild.channels.cache.get(voiceChannelId);
    if (voice?.type !== ChannelType.GuildVoice) return false;
    if ((voice as VoiceChannel).members.some((member) => !member.user.bot)) return false;
    return this.release(guild, session);
  }

  /** Libera toda reserva viva de um squad (arquivamento). Nunca lança. */
  async releaseForSquad(guild: Guild, squadId: string): Promise<void> {
    try {
      const sessions = await this.liveReservations(guild.id);
      for (const session of sessions) {
        if (session.squadId === squadId) await this.release(guild, session);
      }
    } catch (error) {
      log.warn({ err: error, guildId: guild.id, squadId }, 'falha ao liberar as reservas do squad');
    }
  }

  /** Vou / Não vou. "Vou" conta como sinal de vida do squad. */
  async vote(
    guild: Guild,
    sessionId: number,
    userId: string,
    going: boolean,
  ): Promise<SquadSession> {
    const { db } = this.ctx;
    await this.ctx.requireConfig(guild.id);
    const session = await this.requireSession(guild.id, sessionId);
    if (session.cancelledAt) {
      throw new UserFacingError('Esta jogatina foi cancelada.', { code: 'SESSION_CANCELLED' });
    }
    if (session.endsAt.getTime() <= this.ctx.now()) {
      throw new UserFacingError('Esta jogatina já acabou.', { code: 'SESSION_ENDED' });
    }
    const squad = await this.requireLiveSquad(guild.id, session.squadId);
    await this.ctx.parts.squads.assertMember(guild.id, squad.id, userId, 'responder');

    const updated = await voteSquadSession(db, guild.id, sessionId, userId, going);
    if (going) {
      await touchSquadConfirmed(db, guild.id, squad.id, this.ctx.date());
      // Sem isto, um squad avisado que voltou a jogar seria arquivado direto
      // na próxima vez que ficasse inativo, sem aviso novo.
      await clearSquadWarned(db, guild.id, squad.id);
    }
    if (!updated) return session;
    await this.renderSession(guild, updated, squad);
    await this.ctx.parts.guide.refresh(guild, squad.id);
    return updated;
  }

  /**
   * Squads sem sinal de vida há `inactiveWeeks` semanas: primeiro um aviso com
   * "Ainda jogamos"; sem resposta em 7 dias, arquivamento.
   */
  async checkInactivity(guild: Guild): Promise<InactivityResult> {
    const { db } = this.ctx;
    const config = await this.ctx.config.get(guild.id, 'squads');
    const now = this.ctx.now();
    const inactive = await listInactiveSquads(
      db,
      guild.id,
      new Date(now - config.inactiveWeeks * WEEK_MS),
    );

    const result: InactivityResult = { warned: [], archived: [] };
    for (const squad of inactive) {
      try {
        if (!squad.warnedAt) {
          if (!(await markSquadWarned(db, guild.id, squad.id, this.ctx.date()))) continue;
          result.warned.push(squad.id);
          await this.sendWarning(guild, squad, config.inactiveWeeks);
        } else if (now - squad.warnedAt.getTime() >= INACTIVITY_GRACE_MS) {
          const archived = await this.ctx.parts.squads.archive(guild, squad.id, {
            reason: `Sem sinal de vida por ${String(config.inactiveWeeks)} semanas.`,
            source: 'job',
          });
          if (archived) result.archived.push(squad.id);
        }
      } catch (error) {
        log.error({ err: error, guildId: guild.id, squadId: squad.id }, 'falha na inatividade');
      }
    }
    return result;
  }

  private async sendWarning(guild: Guild, squad: Squad, weeks: number): Promise<void> {
    const channel = await this.ctx.textChannel(guild, squad);
    if (!channel) return;
    const memberIds = await this.memberIds(guild.id, squad.id);
    await channel
      .send(
        inactivityWarningMessage({
          squad,
          memberIds,
          weeks,
          embedColor: await this.ctx.embedColor(guild.id),
        }),
      )
      .catch(
        logFailure('não foi possível avisar a inatividade', {
          guildId: guild.id,
          squadId: squad.id,
        }),
      );
  }

  private async requireSession(guildId: string, sessionId: number): Promise<SquadSession> {
    const session = await getSquadSession(this.ctx.db, guildId, sessionId);
    if (!session) {
      throw new UserFacingError('Esta jogatina não existe mais.', { code: 'SESSION_NOT_FOUND' });
    }
    return session;
  }

  private async requireLiveSquad(guildId: string, squadId: string): Promise<Squad> {
    const squad = await getSquad(this.ctx.db, guildId, squadId);
    if (!squad || squad.status === 'archived') {
      throw new UserFacingError('Este squad foi encerrado.', { code: 'SQUAD_ARCHIVED' });
    }
    return squad;
  }

  private async memberIds(guildId: string, squadId: string): Promise<string[]> {
    return (await listSquadMembers(this.ctx.db, guildId, squadId)).map((member) => member.userId);
  }

  /** Quem pediu uma jogatina que já existe vira "vou" nela. */
  private async joinExisting(
    guild: Guild,
    squad: Squad,
    session: SquadSession,
    by: string,
  ): Promise<ScheduleResult> {
    const current = session.goingIds.includes(by)
      ? session
      : await this.vote(guild, session.id, by, true);
    return { outcome: 'exists', session: current, squad };
  }

  /**
   * A mensagem da jogatina no canal do squad, chamando os membros. Falha no
   * envio não desfaz a jogatina: o lembrete manda a mensagem de novo.
   */
  private async announce(guild: Guild, squad: Squad, session: SquadSession): Promise<SquadSession> {
    const bindings = { guildId: guild.id, sessionId: session.id };
    const channel = await this.ctx.textChannel(guild, squad);
    if (!channel) {
      log.warn(bindings, 'squad sem canal para anunciar a jogatina');
      return session;
    }
    try {
      const message = await channel.send(
        await this.view(guild, session, squad, { mentionMembers: true }),
      );
      return (await setSessionMessage(this.ctx.db, guild.id, session.id, message.id)) ?? session;
    } catch (error) {
      log.warn({ err: error, ...bindings }, 'falha ao anunciar a jogatina');
      return session;
    }
  }

  private async view(
    guild: Guild,
    session: SquadSession,
    squad: Squad,
    options: { mentionMembers: boolean },
  ) {
    const [config, embedColor, memberIds] = await Promise.all([
      this.ctx.config.get(guild.id, 'squads'),
      this.ctx.embedColor(guild.id),
      this.memberIds(guild.id, squad.id),
    ]);
    return sessionMessage({
      session,
      squad,
      memberIds,
      voiceChannelId: isReserved(session) ? session.voiceChannelId : null,
      state: sessionState(session),
      reminderMinutesBefore: config.reminderMinutesBefore,
      embedColor,
      mentionMembers: options.mentionMembers,
    });
  }

  /** Reedita a mensagem da jogatina com o estado atual; nunca lança. */
  private async renderSession(guild: Guild, session: SquadSession, squad: Squad): Promise<void> {
    if (!session.messageId) return;
    const messageId = session.messageId;
    const bindings = { guildId: guild.id, sessionId: session.id };
    try {
      const channel = await this.ctx.textChannel(guild, squad);
      const message = await channel?.messages.fetch(messageId).catch(() => null);
      if (!message) return;
      const fresh = (await getSquadSession(this.ctx.db, guild.id, session.id)) ?? session;
      await message
        .edit(await this.view(guild, fresh, squad, { mentionMembers: false }))
        .catch(logFailure('não foi possível atualizar a jogatina', bindings));
    } catch (error) {
      log.warn({ err: error, ...bindings }, 'falha ao atualizar a jogatina');
    }
  }

  /** Reservas ainda não liberadas, recentes ou vencidas. */
  private async liveReservations(guildId: string): Promise<SquadSession[]> {
    const now = this.ctx.now();
    const [recent, stale] = await Promise.all([
      listSessionsStartingBetween(
        this.ctx.db,
        guildId,
        new Date(now - RESERVATION_LOOKAROUND_MS),
        new Date(now + RESERVATION_LOOKAROUND_MS),
      ),
      listSessionsToRelease(this.ctx.db, guildId, new Date(now)),
    ]);
    const byId = new Map<number, SquadSession>();
    for (const session of [...recent, ...stale]) {
      if (isReserved(session)) byId.set(session.id, session);
    }
    return [...byId.values()];
  }

  /**
   * Voices segurados por outra jogatina. Qualquer reserva ainda não liberada
   * conta, mesmo sem cruzar o horário: duas reservas vivas no mesmo canal
   * gravariam uma o estado da outra no snapshot, e a primeira liberação
   * devolveria o `@everyone` errado.
   */
  private async heldVoices(guildId: string, exceptSessionId: number): Promise<Set<string>> {
    const held = new Set<string>();
    for (const session of await this.liveReservations(guildId)) {
      if (session.id !== exceptSessionId && session.voiceChannelId)
        held.add(session.voiceChannelId);
    }
    return held;
  }
}
