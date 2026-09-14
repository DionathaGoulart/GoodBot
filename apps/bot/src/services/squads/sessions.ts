import {
  clearSquadWarned,
  getActiveSessionByVoice,
  getSquad,
  getSquadSession,
  listInactiveSquads,
  listSessionsStartingBetween,
  listSessionsToRelease,
  listSquadMembers,
  listSquads,
  markSessionReminded,
  markSessionStarted,
  markSquadWarned,
  releaseSessionVoice,
  reserveSessionVoice,
  setSessionReminderMessage,
  touchSquadConfirmed,
  upsertSquadSession,
  voteSquadSession,
} from '@goodbot/db';
import { DAY_MS, nextSessionAt, UserFacingError, WEEK_MS } from '@goodbot/shared';
import { ChannelType } from 'discord.js';

import { currentOverwrites, snapshotOverwrites } from '../../lib/overwrites';
import { isLockable } from '../locks';
import { discordErrorCode, log, logFailure } from './context';
import { inactivityWarningMessage, sessionReminderMessage, sessionStartMessage } from './embeds';
import {
  encodeVoiceSnapshot,
  restoreVoiceOverwrites,
  SQUAD_VOICE_REQUIRED_BITS,
  voiceReservationAffectedIds,
  voiceReservationOverwrites,
} from './overwrites';

import type { LockableChannel } from '../locks';
import type { SquadContext } from './context';
import type { Squad, SquadSession } from '@goodbot/db';
import type { Guild, VoiceChannel } from 'discord.js';

/** Depois do aviso de inatividade, quanto o squad tem para responder antes de ser arquivado. */
export const INACTIVITY_GRACE_MS = WEEK_MS;

/**
 * Até onde procurar reservas vivas. A reserva sai no lembrete (no máximo 4 h
 * antes) e é liberada no fim da faixa (no máximo 24 h depois do início); o
 * que passou disso e ainda não foi liberado cai em `listSessionsToRelease`.
 */
const RESERVATION_LOOKAROUND_MS = 2 * DAY_MS;

/** `DiscordAPIError` de canal inexistente: o voice foi apagado. */
const DISCORD_UNKNOWN_CHANNEL = 10003;

export interface RemindResult {
  session: SquadSession;
  voiceChannelId: string | null;
}

export interface StartResult {
  moved: string[];
  pinged: string[];
}

export interface InactivityResult {
  warned: string[];
  archived: string[];
}

const isReserved = (session: SquadSession) =>
  session.voiceReservedAt !== null && session.voiceReleasedAt === null;

/**
 * Sessões semanais. Tudo aqui é chamado pelo job de 5 em 5 minutos, então
 * cada passo é idempotente: a trava é sempre uma `UPDATE` condicional no
 * banco, antes de qualquer coisa no Discord.
 */
export class SessionService {
  constructor(private readonly ctx: SquadContext) {}

  /** A próxima sessão (ou a em andamento) de cada squad vivo, no fuso da guild. */
  async ensureUpcoming(guildId: string): Promise<SquadSession[]> {
    const { db } = this.ctx;
    const config = await this.ctx.config.get(guildId, 'squads');
    const settings = await this.ctx.config.getSettings(guildId);
    const squads = await listSquads(db, guildId, { statuses: ['open', 'full'] });

    const sessions: SquadSession[] = [];
    for (const squad of squads) {
      try {
        const window = nextSessionAt(
          squad.day,
          squad.block,
          config.blocks,
          settings.timezone,
          this.ctx.date(),
        );
        sessions.push(
          await upsertSquadSession(db, {
            guildId,
            squadId: squad.id,
            startsAt: window.startsAt,
            endsAt: window.endsAt,
          }),
        );
      } catch (error) {
        log.warn({ err: error, guildId, squadId: squad.id }, 'não foi possível agendar a sessão');
      }
    }
    return sessions;
  }

  /**
   * Lembrete com Vou / Não vou. A reserva do voice vem antes da mensagem para
   * o lembrete já dizer qual é a sala (ou que não há sala), num envio só.
   * `null` quando o lembrete já tinha saído.
   */
  async remind(guild: Guild, session: SquadSession): Promise<RemindResult | null> {
    const { db } = this.ctx;
    const marked = await markSessionReminded(db, guild.id, session.id, this.ctx.date());
    if (!marked) return null;

    const squad = await getSquad(db, guild.id, marked.squadId);
    if (!squad || squad.status === 'archived') return { session: marked, voiceChannelId: null };

    const voiceChannelId = await this.reserveVoice(guild, marked);
    const channel = await this.ctx.textChannel(guild, squad);
    if (!channel) {
      log.warn({ guildId: guild.id, squadId: squad.id }, 'squad sem canal para o lembrete');
      return { session: marked, voiceChannelId };
    }

    try {
      const memberIds = (await listSquadMembers(db, guild.id, squad.id)).map((m) => m.userId);
      const message = await channel.send(
        sessionReminderMessage({
          session: marked,
          squad,
          memberIds,
          voiceChannelId,
          embedColor: await this.ctx.embedColor(guild.id),
          mentionMembers: true,
        }),
      );
      const saved = await setSessionReminderMessage(db, guild.id, marked.id, message.id);
      return { session: saved ?? marked, voiceChannelId };
    } catch (error) {
      log.warn(
        { err: error, guildId: guild.id, sessionId: marked.id },
        'falha ao enviar o lembrete',
      );
      return { session: marked, voiceChannelId };
    }
  }

  /**
   * Reserva um voice do pool para a sessão: o preferido do squad, se ninguém
   * o segura, ou o primeiro livre. O snapshot dos overwrites é gravado antes
   * de mexer no canal, e é da sessão (não de `channel_locks`): um `/lock` no
   * mesmo voice não pode trocar o que a liberação restaura. Nunca lança;
   * `null` = sem sala.
   */
  async reserveVoice(guild: Guild, session: SquadSession): Promise<string | null> {
    if (session.voiceReservedAt) return isReserved(session) ? session.voiceChannelId : null;
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
        log.info({ guildId, sessionId: session.id }, 'pool de voices cheio; sessão sem sala');
        return null;
      }
      const voice = guild.channels.cache.get(voiceId) as VoiceChannel;

      // O bot não dá nem nega num overwrite o que ele mesmo não tem, e o
      // PRD §10 ainda não pede `Connect`: sem a checagem, o `set` falharia.
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

      const memberIds = (await listSquadMembers(db, guildId, squad.id)).map((m) => m.userId);
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
          `Sessão do squad ${squad.name}`,
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
   * "Não vou" fica em paz. `null` quando a sessão já tinha começado.
   */
  async start(guild: Guild, session: SquadSession): Promise<StartResult | null> {
    const { db } = this.ctx;
    const marked = await markSessionStarted(db, guild.id, session.id, this.ctx.date());
    if (!marked) return null;

    const result: StartResult = { moved: [], pinged: [] };
    const squad = await getSquad(db, guild.id, marked.squadId);
    if (!squad || squad.status === 'archived') return result;

    const voiceId = isReserved(marked) ? marked.voiceChannelId : null;
    const members = await listSquadMembers(db, guild.id, squad.id);
    for (const { userId } of members) {
      if (marked.notGoingIds.includes(userId)) continue;
      const state = guild.voiceStates.cache.get(userId);
      if (!state?.channelId) {
        result.pinged.push(userId);
        continue;
      }
      if (!voiceId || state.channelId === voiceId) continue;
      try {
        await state.setChannel(voiceId, `Sessão do squad ${squad.name}`);
        result.moved.push(userId);
      } catch (error) {
        log.warn({ err: error, guildId: guild.id, userId }, 'não foi possível mover para o voice');
      }
    }

    if (result.pinged.length > 0) {
      const channel = await this.ctx.textChannel(guild, squad);
      await channel
        ?.send(sessionStartMessage({ userIds: result.pinged, voiceChannelId: voiceId }))
        .catch(
          logFailure('não foi possível chamar o squad', { guildId: guild.id, squadId: squad.id }),
        );
    }
    return result;
  }

  /**
   * Libera a reserva: os ids que ela tocou voltam ao snapshot, o resto do
   * canal fica como está. O Discord vem antes do banco: se o restore falha
   * (rate limit, 5xx, 50013 passageiro), a sessão continua reservada e a
   * próxima passada do job tenta de novo. Marcar antes deixaria o voice do
   * pool com `Connect` negado ao `@everyone` para sempre, porque
   * `listSessionsToRelease` nunca mais devolveria a sessão.
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
            'Fim da sessão do squad',
          );
          restored = true;
        } catch (error) {
          log.warn({ err: error, ...bindings }, 'falha ao liberar o voice; o job tenta de novo');
          return false;
        }
      } else {
        log.info(bindings, 'voice da sessão não existe mais');
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
        'não foi possível buscar o voice da sessão; o job tenta de novo',
      );
      return 'retry';
    }
  }

  /**
   * Alguém entrou num voice. Se é o voice reservado de uma sessão viva e a
   * pessoa é do squad, é a prova mais forte de que o squad joga: vale como
   * confirmação e desfaz o aviso de inatividade. `true` quando contou.
   */
  async confirmPresence(guild: Guild, voiceChannelId: string, userId: string): Promise<boolean> {
    const { db } = this.ctx;
    const session = await getActiveSessionByVoice(db, guild.id, voiceChannelId, this.ctx.date());
    if (!session) return false;
    const members = await listSquadMembers(db, guild.id, session.squadId);
    if (!members.some((member) => member.userId === userId)) return false;
    await touchSquadConfirmed(db, guild.id, session.squadId, this.ctx.date());
    await clearSquadWarned(db, guild.id, session.squadId);
    return true;
  }

  /**
   * O voice reservado esvaziou. Depois do início da sessão, a reserva sai
   * antes do fim da faixa, para a sala voltar ao servidor; antes do início
   * não, porque o squad ainda está chegando. `true` quando liberou.
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

  /** Vou / Não vou. "Vou" conta como confirmação de que o squad está vivo. */
  async vote(
    guild: Guild,
    sessionId: number,
    userId: string,
    going: boolean,
  ): Promise<SquadSession> {
    const { db } = this.ctx;
    await this.ctx.requireConfig(guild.id);
    const session = await getSquadSession(db, guild.id, sessionId);
    if (!session) {
      throw new UserFacingError('Esta sessão não existe mais.', { code: 'SESSION_NOT_FOUND' });
    }
    const squad = await getSquad(db, guild.id, session.squadId);
    if (!squad || squad.status === 'archived') {
      throw new UserFacingError('Este squad foi encerrado.', { code: 'SQUAD_ARCHIVED' });
    }
    await this.ctx.parts.squads.assertMember(guild.id, squad.id, userId, 'responder');

    const updated = (await voteSquadSession(db, guild.id, sessionId, userId, going)) ?? session;
    if (going) {
      await touchSquadConfirmed(db, guild.id, squad.id, this.ctx.date());
      // Sem isto, um squad avisado que voltou a jogar seria arquivado direto
      // na próxima vez que ficasse inativo, sem aviso novo.
      await clearSquadWarned(db, guild.id, squad.id);
    }
    await this.renderReminder(guild, updated, squad);
    return updated;
  }

  /**
   * Squads sem confirmação há `inactiveWeeks` semanas: primeiro um aviso com
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
            reason: `Sem confirmação de presença por ${String(config.inactiveWeeks)} semanas.`,
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
    const memberIds = (await listSquadMembers(this.ctx.db, guild.id, squad.id)).map(
      (m) => m.userId,
    );
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

  /** Reedita a contagem de votos no lembrete; nunca lança. */
  private async renderReminder(guild: Guild, session: SquadSession, squad: Squad): Promise<void> {
    if (!session.reminderMessageId) return;
    const messageId = session.reminderMessageId;
    const bindings = { guildId: guild.id, sessionId: session.id };
    try {
      const channel = await this.ctx.textChannel(guild, squad);
      const message = await channel?.messages.fetch(messageId).catch(() => null);
      if (!message) return;
      const memberIds = (await listSquadMembers(this.ctx.db, guild.id, squad.id)).map(
        (m) => m.userId,
      );
      await message
        .edit(
          sessionReminderMessage({
            session,
            squad,
            memberIds,
            voiceChannelId: isReserved(session) ? session.voiceChannelId : null,
            embedColor: await this.ctx.embedColor(guild.id),
            mentionMembers: false,
          }),
        )
        .catch(logFailure('não foi possível atualizar o lembrete', bindings));
    } catch (error) {
      log.warn({ err: error, ...bindings }, 'falha ao atualizar o lembrete');
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
   * Voices segurados por outra sessão. Qualquer reserva ainda não liberada
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
