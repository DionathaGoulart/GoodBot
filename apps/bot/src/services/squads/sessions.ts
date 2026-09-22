import {
  appendSessionVoiceSnapshot,
  cancelSquadSession,
  clearSquadWarned,
  closeAttendanceRow,
  closeSessionAttendance,
  createSquadSession,
  getActiveSessionByVoice,
  getSquad,
  getSquadGame,
  getSquadSession,
  getSquadSessionAt,
  listInactiveSquads,
  listLiveTemporaryVoiceIds,
  listOpenAttendance,
  listPendingTemporaryVoices,
  listSessionGuests,
  listSessionsStartingBetween,
  listSessionsToRelease,
  listSquadMembers,
  listUpcomingSessions,
  markSessionPlayed,
  markSessionReminded,
  markSessionStarted,
  markSquadWarned,
  openSessionAttendance,
  releaseSessionVoice,
  reopenSquadSession,
  rescheduleSquadSession,
  reserveSessionVoice,
  setSessionMessage,
  setSessionTemporaryVoice,
  touchSquadConfirmed,
  voteSquadSession,
} from '@goodbot/db';
import {
  addLocalDays,
  DAY_MS,
  describeWhen,
  HOUR_MS,
  isSessionOver,
  MINUTE_MS,
  parseWhen,
  SECOND_MS,
  snowflakeToDate,
  SQUAD_PRESENCE_LEAD_MS,
  UserFacingError,
  WEEK_MS,
} from '@goodbot/shared';
import { ChannelType, OverwriteType } from 'discord.js';

import { currentOverwrites, snapshotOverwrites } from '../../lib/overwrites';
import { isLockable } from '../locks';
import { callBlocker } from './calls';
import { discordErrorCode, log, logFailure } from './context';
import {
  inactivityWarningMessage,
  sessionMessage,
  sessionReminderMessage,
  sessionRescheduledMessage,
  sessionStartMessage,
  temporaryVoiceName,
} from './embeds';
import { rescheduleModal } from './forms';
import { guestBlocker } from './guests';
import {
  encodeVoiceSnapshot,
  hasTemporaryVoiceSignature,
  restoreVoiceOverwrites,
  SQUAD_VOICE_MEMBER_EDIT,
  SQUAD_VOICE_REQUIRED_BITS,
  temporaryVoiceOverwrites,
  voiceReservationAffectedIds,
  voiceReservationOverwrites,
  voiceSnapshotEntry,
} from './overwrites';

import type { LockableChannel } from '../locks';
import type { SquadContext } from './context';
import type { SessionState } from './embeds';
import type { Squad, SquadGame, SquadSession } from '@goodbot/db';
import type { AuditSource } from '@goodbot/shared';
import type { Guild, ModalBuilder, VoiceChannel } from 'discord.js';

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

/**
 * Quanto uma criação de voice temporário pode levar: o REST tem teto de 15 s e
 * uma repetição. A reconciliação só olha reservas mais velhas que isso, para
 * não disputar com uma criação em curso.
 */
export const TEMPORARY_VOICE_GRACE_MS = 2 * MINUTE_MS;
/** Até quando uma reserva sem canal é procurada: a jogatina dura no máximo 12 h. */
const TEMPORARY_VOICE_LOOKBACK_MS = DAY_MS;
/** Folga entre o relógio da VM e o do Discord ao comparar a reserva com o id do canal. */
const CLOCK_SKEW_MS = 30 * SECOND_MS;

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

/** O que a varredura de presença acertou. */
export interface SweepResult {
  /** Presenças abertas para quem estava no voice reservado sem linha aberta. */
  opened: number;
  /** Presenças fechadas de quem não está mais no voice da jogatina. */
  closed: number;
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

export interface RescheduleOptions {
  startsAt: Date;
  /** Quem remarca; precisa estar no VOU. */
  by: string;
  source: AuditSource;
}

export type RescheduleResult =
  | { outcome: 'rescheduled'; session: SquadSession; squad: Squad; from: Date }
  /** Já era esse o horário: nada mudou e ninguém foi avisado. */
  | { outcome: 'unchanged'; session: SquadSession; squad: Squad };

const isReserved = (session: SquadSession) =>
  session.voiceReservedAt !== null && session.voiceReleasedAt === null;

export function sessionState(
  session: Pick<SquadSession, 'cancelledAt' | 'startedAt'>,
): SessionState {
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
  /**
   * Voices temporários de pé, por guild. O evento de voz pergunta a cada troca
   * de canal se o canal é de squad, e fora do pool isso não pode custar uma
   * query: a lista vem do banco na primeira pergunta de cada guild (o que cobre
   * reinício no meio da jogatina) e depois acompanha criação e liberação.
   */
  private readonly temporaryVoices = new Map<string, Set<string>>();

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
      after: {
        sessionId: session.id,
        startsAt: startsAt.toISOString(),
        reopened: existing !== null,
      },
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
    await this.ctx.parts.calls.close(guild, cancelled);
    if (isReserved(cancelled)) await this.release(guild, cancelled);
    await this.ctx.parts.guests.notify(guild, cancelled, {
      kind: 'cancelled',
      startsAt: cancelled.startsAt,
    });
    await this.renderSession(guild, cancelled, squad);
    await this.ctx.parts.guide.refresh(guild, squad.id);
    return { outcome: 'cancelled', session: cancelled };
  }

  /**
   * Quem pode remarcar a jogatina agora: membro do squad, no VOU, antes do
   * início. O botão confere antes de abrir o modal, para ninguém digitar um
   * horário e só então ouvir que não pode; a remarcação confere de novo.
   */
  async requireReschedulable(
    guildId: string,
    sessionId: number,
    by: string,
  ): Promise<{ session: SquadSession; squad: Squad }> {
    await this.ctx.requireConfig(guildId);
    const session = await this.requireSession(guildId, sessionId);
    const squad = await this.requireLiveSquad(guildId, session.squadId);
    await this.ctx.parts.squads.assertMember(guildId, squad.id, by, 'remarcar a jogatina');
    if (session.cancelledAt) {
      throw new UserFacingError('Esta jogatina foi cancelada.', { code: 'SESSION_CANCELLED' });
    }
    if (session.startedAt) {
      throw new UserFacingError('A jogatina já começou: não dá mais para remarcar.', {
        code: 'SESSION_STARTED',
      });
    }
    if (!session.goingIds.includes(by)) {
      throw new UserFacingError('Só quem vai remarca. Aperte VOU para poder remarcar.', {
        code: 'SESSION_NOT_GOING',
      });
    }
    return { session, squad };
  }

  /** O modal do REMARCAR, com o horário atual escrito no fuso da guild. */
  async rescheduleForm(guild: Guild, sessionId: number, by: string): Promise<ModalBuilder> {
    const { session } = await this.requireReschedulable(guild.id, sessionId, by);
    const { timezone } = await this.ctx.config.getSettings(guild.id);
    return rescheduleModal(session, describeWhen(session.startsAt, this.ctx.date(), timezone));
  }

  /** O "quando" novo digitado no modal, lido no fuso da guild. */
  async rescheduleFromText(
    guild: Guild,
    sessionId: number,
    by: string,
    when: string,
    source: AuditSource,
  ): Promise<RescheduleResult> {
    await this.ctx.requireConfig(guild.id);
    const { timezone } = await this.ctx.config.getSettings(guild.id);
    const startsAt = parseWhen(when, this.ctx.date(), timezone);
    return this.reschedule(guild, sessionId, { startsAt, by, source });
  }

  /**
   * REMARCAR: o horário muda e o resto fica (votos, mensagem, chamada). Quem
   * remarca é quem está no VOU, e só antes do início.
   *
   * A sala acompanha o horário novo. Com o lembrete já dado e o horário novo
   * fora da antecedência dele, a reserva volta ao pool e o lembrete é zerado,
   * para o job lembrar e reservar de novo perto da hora; senão um voice do pool
   * ficaria trancado até lá. Como na liberação, o Discord vem antes do banco:
   * sala que não volta deixa a jogatina no horário antigo. Horário novo dentro
   * da antecedência reserva na hora; `agora` também começa.
   *
   * O squad inteiro é chamado numa mensagem à parte (editar a da jogatina não
   * notifica): quem disse NÃO VOU para o horário antigo pode poder no novo.
   */
  async reschedule(
    guild: Guild,
    sessionId: number,
    options: RescheduleOptions,
  ): Promise<RescheduleResult> {
    const { db } = this.ctx;
    const guildId = guild.id;
    const config = await this.ctx.requireConfig(guildId);
    const { startsAt, by } = options;
    const found = await this.requireReschedulable(guildId, sessionId, by);
    const { squad } = found;
    let session = found.session;
    const from = session.startsAt;
    if (startsAt.getTime() === from.getTime()) return { outcome: 'unchanged', session, squad };

    const now = this.ctx.now();
    const endsAt = new Date(startsAt.getTime() + config.sessionHours * HOUR_MS);
    if (endsAt.getTime() <= now) {
      throw new UserFacingError('Esse horário já passou.', { code: 'WHEN_PAST' });
    }
    await this.assertMinuteFree(guildId, session, startsAt);

    const lead = config.reminderMinutesBefore * MINUTE_MS;
    const resetReminder = session.remindedAt !== null && startsAt.getTime() - now > lead;
    // Voice temporário ainda sem id é criação pendente: zerar a reserva apagaria
    // o rastro que a reconciliação usa para achar o canal que pode ter nascido.
    const pendingVoice = session.voiceTemporary && session.voiceChannelId === null;
    if (
      resetReminder &&
      isReserved(session) &&
      (pendingVoice || !(await this.release(guild, session)))
    ) {
      throw new UserFacingError(
        'Não consegui devolver a sala reservada agora, então a jogatina continua no horário antigo. Tente de novo em alguns minutos.',
        { code: 'SESSION_VOICE_BUSY' },
      );
    }

    const result = await rescheduleSquadSession(db, guildId, session.id, {
      startsAt,
      endsAt,
      resetReminder,
    });
    if (result.outcome !== 'rescheduled') {
      // Outra jogatina ocupou o minuto, ou esta começou ou foi cancelada no
      // meio do caminho: as checagens de novo dizem o quê.
      const fresh = await this.requireReschedulable(guildId, session.id, by);
      await this.assertMinuteFree(guildId, fresh.session, startsAt);
      throw new UserFacingError('Não consegui remarcar agora. Tente de novo em alguns minutos.', {
        code: 'SESSION_BUSY',
      });
    }
    session = result.session;

    this.ctx.record({
      guildId,
      action: 'squad.session.reschedule',
      source: options.source,
      actor: by,
      target: { type: 'squad', id: squad.id },
      before: { sessionId: session.id, startsAt: from.toISOString() },
      after: { sessionId: session.id, startsAt: startsAt.toISOString() },
    });
    // Quem estava na sala devolvida não está mais no voice de jogatina nenhuma.
    if (resetReminder) await this.sweepSafely(guild);

    const startsNow = startsAt.getTime() <= now;
    if (!startsNow) await this.ctx.parts.calls.refreshMessage(guild, session);
    let rendered = false;
    if (startsAt.getTime() - now <= lead) {
      const reminded = await this.remind(guild, session, { quiet: true });
      if (reminded) {
        session = reminded.session;
        rendered = true;
      }
    }
    await this.noticeReschedule(guild, squad, session, { from, by, startsNow });
    // Começando agora, o aviso do início já diz ao convidado onde entrar.
    if (!startsNow) {
      await this.ctx.parts.guests.notify(guild, session, {
        kind: 'rescheduled',
        from,
        startsAt: session.startsAt,
      });
    }
    if (startsNow) {
      await this.start(guild, session);
      session = (await getSquadSession(db, guildId, session.id)) ?? session;
    } else if (!rendered) {
      await this.renderSession(guild, session, squad);
    }
    await this.ctx.parts.guide.refresh(guild, squad.id);
    return { outcome: 'rescheduled', session, squad, from };
  }

  /**
   * O minuto novo não pode ser de outra jogatina do squad: `(squad_id,
   * starts_at)` é único, e vale também para a cancelada, que segura o minuto
   * para o BORA reabri-la.
   */
  private async assertMinuteFree(
    guildId: string,
    session: SquadSession,
    startsAt: Date,
  ): Promise<void> {
    const other = await getSquadSessionAt(this.ctx.db, guildId, session.squadId, startsAt);
    if (!other || other.id === session.id) return;
    if (!other.cancelledAt) {
      throw new UserFacingError(
        'O squad já tem outra jogatina nesse horário. Aperte VOU nela em vez de remarcar esta.',
        { code: 'SESSION_TAKEN' },
      );
    }
    const { timezone } = await this.ctx.config.getSettings(guildId);
    const nearby = describeWhen(
      new Date(startsAt.getTime() + 5 * MINUTE_MS),
      this.ctx.date(),
      timezone,
    );
    throw new UserFacingError(
      `Esse horário tem uma jogatina cancelada do squad, e duas não cabem no mesmo minuto. Use um minuto diferente, como ${nearby}.`,
      { code: 'SESSION_TAKEN' },
    );
  }

  /** O aviso da remarcação no canal do squad; falha fica no log. */
  private async noticeReschedule(
    guild: Guild,
    squad: Squad,
    session: SquadSession,
    change: { from: Date; by: string; startsNow: boolean },
  ): Promise<void> {
    const channel = await this.ctx.textChannel(guild, squad);
    if (!channel) return;
    // Começando agora, o início chama e move quem vai; o aviso chama só quem
    // tinha recusado, que o início deixa em paz.
    const called = change.startsNow
      ? session.notGoingIds
      : await this.memberIds(guild.id, squad.id);
    await channel
      .send(
        sessionRescheduledMessage({
          userIds: called.filter((id) => id !== change.by),
          by: change.by,
          from: change.from,
          startsAt: session.startsAt,
          startsNow: change.startsNow,
          voiceChannelId: isReserved(session) ? session.voiceChannelId : null,
          voiceTemporary: isReserved(session) && session.voiceTemporary,
          reminded: session.remindedAt !== null,
        }),
      )
      .catch(
        logFailure('não foi possível avisar a remarcação', {
          guildId: guild.id,
          sessionId: session.id,
        }),
      );
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
   * `null` quando o lembrete já tinha saído ou quando a jogatina, remarcada
   * depois de o job listá-la, já não começa dentro da antecedência.
   */
  async remind(
    guild: Guild,
    session: SquadSession,
    options: RemindOptions = {},
  ): Promise<RemindResult | null> {
    const { db } = this.ctx;
    const { reminderMinutesBefore } = await this.ctx.config.get(guild.id, 'squads');
    const startsBy = new Date(this.ctx.now() + reminderMinutesBefore * MINUTE_MS);
    const marked = await markSessionReminded(db, guild.id, session.id, this.ctx.date(), {
      startsBy,
    });
    if (!marked) return null;
    if (marked.cancelledAt) return { session: marked, voiceChannelId: null };

    const squad = await getSquad(db, guild.id, marked.squadId);
    if (!squad || squad.status === 'archived') return { session: marked, voiceChannelId: null };

    const voiceChannelId = await this.reserveVoice(guild, marked);
    // Quem já estava no voice antes da reserva não gera evento de entrada.
    if (voiceChannelId) await this.sweepSafely(guild);
    const current = (await getSquadSession(db, guild.id, marked.id)) ?? marked;
    const voiceTemporary = voiceChannelId !== null && current.voiceTemporary;
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
          .send(
            sessionReminderMessage({
              userIds,
              startsAt: current.startsAt,
              voiceChannelId,
              voiceTemporary,
            }),
          )
          .catch(
            logFailure('falha ao enviar o lembrete', { guildId: guild.id, sessionId: current.id }),
          );
      }
    }
    return { session: current, voiceChannelId };
  }

  /**
   * Reserva um voice do pool para a jogatina: o preferido do squad, se ninguém
   * o segura, ou o primeiro livre. O snapshot dos overwrites é gravado antes
   * de mexer no canal, e é da jogatina (não de `channel_locks`): um `/lock` no
   * mesmo voice não pode trocar o que a liberação restaura. Sem nenhum livre,
   * cria um voice temporário (`temporaryVoices`). Nunca lança; `null` = sem
   * sala.
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
        if (config.temporaryVoices) return await this.createTemporaryVoice(guild, squad, session);
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
      const guestIds = await this.guestIds(guildId, session.id);
      // Convidado entra na sala como membro, e o snapshot guarda o voice dele também.
      const targets = {
        everyoneId: guild.roles.everyone.id,
        botId: me.id,
        memberIds: [...memberIds, ...guestIds],
      };
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
        after: {
          squadId: squad.id,
          sessionId: session.id,
          memberIds,
          ...(guestIds.length > 0 ? { guestIds } : {}),
        },
      });
      return voiceId;
    } catch (error) {
      log.error({ err: error, guildId, sessionId: session.id }, 'falha na reserva do voice');
      return null;
    }
  }

  /**
   * Dá o voice das reservas vivas do squad a quem acabou de entrar nele. A
   * reserva libera quem era membro quando saiu, e sem isto quem é aceito com a
   * sala já trancada fica do lado de fora da jogatina do próprio squad.
   *
   * No voice do pool, o overwrite que a pessoa tinha entra no snapshot
   * **antes** de mexer no canal: a liberação só restaura os ids do snapshot, e
   * um overwrite concedido fora dele ficaria no voice para sempre. O voice
   * temporário é apagado no fim e não tem snapshot: só concede. Jogatina
   * cancelada fica de fora, porque a sala dela está voltando ao pool. Nunca
   * lança; devolve em quantos voices concedeu.
   */
  async grantLiveVoice(guild: Guild, squadId: string, userId: string): Promise<number> {
    let granted = 0;
    try {
      for (const session of await this.liveReservations(guild.id)) {
        if (session.squadId !== squadId || session.cancelledAt || !session.voiceChannelId) continue;
        const reason = 'Entrou no squad com a jogatina de sala reservada';
        if (await this.grantVoice(guild, session, session.voiceChannelId, userId, reason)) {
          granted++;
        }
      }
    } catch (error) {
      log.warn(
        { err: error, guildId: guild.id, squadId, userId },
        'falha ao dar o voice da jogatina a quem entrou no squad',
      );
    }
    return granted;
  }

  /**
   * A sala da jogatina do squad que está rolando agora; `null` quando não há
   * nenhuma. Quem entra no squad no meio de uma precisa saber onde cair, e o
   * canal do squad só passa a existir para a pessoa depois de ela entrar.
   * Nunca lança.
   */
  async runningRoom(
    guildId: string,
    squadId: string,
  ): Promise<{ voiceChannelId: string | null; voiceTemporary: boolean } | null> {
    try {
      const now = this.ctx.now();
      // Uma jogatina dura no máximo 12 h: um dia para trás pega toda começada.
      const started = await listSessionsStartingBetween(
        this.ctx.db,
        guildId,
        new Date(now - DAY_MS),
        new Date(now + 1),
      );
      const running = started.find(
        (session) =>
          session.squadId === squadId &&
          !session.cancelledAt &&
          session.startedAt !== null &&
          !isSessionOver(session, now),
      );
      if (!running) return null;
      const reserved = isReserved(running);
      return {
        voiceChannelId: reserved ? running.voiceChannelId : null,
        voiceTemporary: reserved && running.voiceTemporary,
      };
    } catch (error) {
      log.warn({ err: error, guildId, squadId }, 'falha ao ler a sala da jogatina em andamento');
      return null;
    }
  }

  /**
   * Dá o voice reservado de uma jogatina só, com a mesma regra da
   * `grantLiveVoice`: é o convidado avulso chegando com a sala já trancada.
   * Sem reserva viva não concede nada, porque a reserva, quando sair, já
   * inclui os convidados. Nunca lança; `true` quando concedeu.
   */
  async grantSessionVoice(
    guild: Guild,
    session: SquadSession,
    userId: string,
    reason: string,
  ): Promise<boolean> {
    if (!isReserved(session) || session.cancelledAt || !session.voiceChannelId) return false;
    try {
      return await this.grantVoice(guild, session, session.voiceChannelId, userId, reason);
    } catch (error) {
      log.warn(
        { err: error, guildId: guild.id, sessionId: session.id, userId },
        'falha ao dar o voice da jogatina ao convidado',
      );
      return false;
    }
  }

  private async grantVoice(
    guild: Guild,
    session: SquadSession,
    voiceId: string,
    userId: string,
    reason: string,
  ): Promise<boolean> {
    const voice = guild.channels.cache.get(voiceId);
    if (voice?.type !== ChannelType.GuildVoice) return false;
    const channel = voice as VoiceChannel;
    if (!session.voiceTemporary) {
      const entry = voiceSnapshotEntry(channel, userId);
      // Liberada no meio do caminho: a sala voltou ao pool e não é mais do squad.
      if (!(await appendSessionVoiceSnapshot(this.ctx.db, guild.id, session.id, entry))) {
        return false;
      }
    }
    try {
      await channel.permissionOverwrites.edit(userId, SQUAD_VOICE_MEMBER_EDIT, {
        type: OverwriteType.Member,
        reason,
      });
      return true;
    } catch (error) {
      log.warn(
        { err: error, guildId: guild.id, sessionId: session.id, voiceChannelId: voiceId, userId },
        'não foi possível dar o voice da jogatina',
      );
      return false;
    }
  }

  /**
   * Na hora: move para o voice reservado quem já está em outra sala da guild
   * e chama, numa mensagem só, quem não está em voice nenhum. Quem votou
   * "Não vou" fica em paz. Sem sala, dois "vou" já contam como jogatina que
   * rolou. `null` quando a jogatina já tinha começado, foi cancelada ou foi
   * remarcada para mais tarde depois de o job listá-la.
   */
  async start(guild: Guild, session: SquadSession): Promise<StartResult | null> {
    const { db } = this.ctx;
    const now = this.ctx.date();
    const marked = await markSessionStarted(db, guild.id, session.id, now, { startsBy: now });
    if (!marked) return null;

    const result: StartResult = { moved: [], pinged: [] };
    const squad = await getSquad(db, guild.id, marked.squadId);
    if (!squad || squad.status === 'archived') {
      // Squad arquivado não recebe mais ninguém: a chamada dele não faz sentido.
      await this.ctx.parts.calls.close(guild, marked);
      return result;
    }
    // A chamada continua no ar durante a jogatina, dizendo que já rolou o começo.
    await this.ctx.parts.calls.refreshMessage(guild, marked);

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
    // Quem já estava na sala não foi movido e não gerou evento. Quem foi
    // movido entra pelo evento de voz, quando o gateway contar.
    if (voiceId) await this.sweepSafely(guild);

    if (!voiceId && marked.goingIds.length >= 2) {
      await markSessionPlayed(db, guild.id, marked.id, this.ctx.date());
    }
    // O convidado não é movido (não pediu para ir) nem chamado no canal do
    // squad, que ele não vê: o aviso vai na thread dele.
    await this.ctx.parts.guests.notify(guild, marked, { kind: 'started', voiceChannelId: voiceId });
    if (result.pinged.length > 0) {
      const channel = await this.ctx.textChannel(guild, squad);
      const guestIds = await this.guestIds(guild.id, marked.id);
      await channel
        ?.send(
          sessionStartMessage({
            userIds: result.pinged,
            voiceChannelId: voiceId,
            goingCount: marked.goingIds.length + guestIds.length,
            partySize: (await this.game(guild.id, squad))?.partySize ?? null,
          }),
        )
        .catch(
          logFailure('não foi possível chamar o squad', { guildId: guild.id, squadId: squad.id }),
        );
    }
    await this.renderSession(guild, marked, squad);
    await this.ctx.parts.guide.refresh(guild, squad.id);
    return result;
  }

  /**
   * O pool está cheio: um voice só desta jogatina, na categoria dos squads,
   * que nasce trancado como uma reserva e é apagado na liberação.
   *
   * A ordem é o que impede voice órfão. A reserva é gravada **antes** de pedir
   * o canal, ainda sem id: quem perde a corrida para outra passada nem chega a
   * criar canal, e um reinício (ou um Discord que não responde) entre pedir o
   * canal e gravar o id deixa rastro no banco, uma reserva temporária sem
   * canal. A `reconcileTemporaryVoices`, no job, acha o canal que nasceu e o
   * adota ou apaga. Nunca lança; `null` = sem sala.
   */
  private async createTemporaryVoice(
    guild: Guild,
    squad: Squad,
    session: SquadSession,
  ): Promise<string | null> {
    const { db } = this.ctx;
    const guildId = guild.id;
    const bindings = { guildId, sessionId: session.id };
    const config = await this.ctx.config.get(guildId, 'squads');
    const me = guild.members.me;
    if (!me) return null;

    // Categoria apagada depois de configurada: o voice nasce na raiz.
    const parent = config.categoryId ? guild.channels.cache.get(config.categoryId) : undefined;
    const permissions = parent ? parent.permissionsFor(me) : me.permissions;
    if (!permissions?.has(SQUAD_VOICE_REQUIRED_BITS)) {
      log.warn(
        { ...bindings, missing: permissions?.missing(SQUAD_VOICE_REQUIRED_BITS) ?? [] },
        'pool de voices cheio e sem permissão para criar voice temporário; jogatina sem sala',
      );
      return null;
    }

    const claimed = await reserveSessionVoice(db, guildId, session.id, {
      voiceChannelId: null,
      overwrites: null,
      temporary: true,
      at: this.ctx.date(),
    });
    if (!claimed) {
      const current = await getSquadSession(db, guildId, session.id);
      return current && isReserved(current) ? current.voiceChannelId : null;
    }

    const memberIds = await this.memberIds(guildId, squad.id);
    const guestIds = await this.guestIds(guildId, session.id);
    let voice: VoiceChannel;
    try {
      voice = await guild.channels.create({
        name: temporaryVoiceName(squad.name),
        type: ChannelType.GuildVoice,
        parent: parent?.id ?? null,
        permissionOverwrites: temporaryVoiceOverwrites({
          everyoneId: guild.roles.everyone.id,
          botId: me.id,
          memberIds: [...memberIds, ...guestIds],
        }),
        reason: `Jogatina do squad ${squad.name} (pool de voices cheio)`,
      });
    } catch (error) {
      if (discordErrorCode(error) !== null) {
        // O Discord respondeu que não (teto de 500 canais, permissão): canal
        // nenhum nasceu, e a reserva vira "sem sala" agora.
        log.warn({ err: error, ...bindings }, 'não foi possível criar o voice temporário');
        await releaseSessionVoice(db, guildId, session.id, this.ctx.date());
      } else {
        // Sem resposta (timeout, 5xx, rede): o canal pode ter nascido. A
        // reserva fica pendente e a reconciliação decide.
        log.warn(
          { err: error, ...bindings },
          'criação do voice temporário sem resposta; a reconciliação confere',
        );
      }
      return null;
    }

    let recorded: SquadSession | null;
    try {
      recorded = await setSessionTemporaryVoice(db, guildId, session.id, voice.id);
    } catch (error) {
      // O canal existe e o banco não tem o id: a reserva continua pendente, e a
      // reconciliação adota o canal na próxima passada.
      log.error({ err: error, ...bindings }, 'falha ao gravar o voice temporário na reserva');
      return null;
    }
    if (!recorded) {
      // A reserva foi liberada enquanto o canal nascia (cancelamento).
      await voice
        .delete('Jogatina liberada enquanto a sala nascia')
        .catch(logFailure('não foi possível apagar o voice temporário que sobrou', bindings));
      return null;
    }

    this.temporaryVoices.get(guildId)?.add(voice.id);
    this.ctx.record({
      guildId,
      action: 'squad.voice.reserve',
      source: 'job',
      target: { type: 'channel', id: voice.id },
      after: {
        squadId: squad.id,
        sessionId: session.id,
        memberIds,
        ...(guestIds.length > 0 ? { guestIds } : {}),
        temporary: true,
      },
    });
    return voice.id;
  }

  /**
   * Resolve as criações de voice temporário que não terminaram (ver
   * `createTemporaryVoice`). Para cada reserva temporária sem canal, feita há
   * mais de `TEMPORARY_VOICE_GRACE_MS`, procura o voice que pode ter nascido:
   * criado logo depois da reserva (a data vem do próprio id), com a assinatura
   * de overwrites do voice temporário e sem dono no banco. Achou e a jogatina
   * ainda vale: adota. Achou e ela acabou, foi cancelada ou liberada: apaga
   * (nunca com gente dentro). Não achou: a criação não chegou ao Discord, e a
   * reserva vira "sem sala".
   *
   * O prazo de carência existe para não disputar com uma criação em curso, que
   * leva no máximo o teto do REST com uma repetição. Devolve quantas resolveu.
   */
  async reconcileTemporaryVoices(guild: Guild): Promise<number> {
    const { db } = this.ctx;
    const now = this.ctx.now();
    const pending = await listPendingTemporaryVoices(
      db,
      guild.id,
      new Date(now - TEMPORARY_VOICE_LOOKBACK_MS),
      new Date(now - TEMPORARY_VOICE_GRACE_MS),
    );
    const me = guild.members.me;
    if (pending.length === 0 || !me) return 0;

    const config = await this.ctx.config.get(guild.id, 'squads');
    const taken = new Set([
      ...config.voicePoolIds,
      ...(await listLiveTemporaryVoiceIds(db, guild.id)),
    ]);
    const signature = { everyoneId: guild.roles.everyone.id, botId: me.id };
    let resolved = 0;

    for (const session of pending) {
      const bindings = { guildId: guild.id, sessionId: session.id };
      const reservedAt = session.voiceReservedAt?.getTime() ?? now;
      const orphan = guild.channels.cache.find((channel) => {
        if (channel.type !== ChannelType.GuildVoice || taken.has(channel.id)) return false;
        const createdAt = snowflakeToDate(channel.id).getTime();
        return (
          createdAt >= reservedAt - CLOCK_SKEW_MS &&
          createdAt <= reservedAt + TEMPORARY_VOICE_GRACE_MS &&
          hasTemporaryVoiceSignature(currentOverwrites(channel), signature)
        );
      });

      if (!orphan) {
        const released =
          isReserved(session) &&
          (await releaseSessionVoice(db, guild.id, session.id, this.ctx.date()));
        if (released) {
          log.info(bindings, 'voice temporário nunca nasceu; jogatina sem sala');
          resolved++;
        }
        continue;
      }
      taken.add(orphan.id);

      const live = isReserved(session) && !session.cancelledAt && session.endsAt.getTime() > now;
      if (live && (await setSessionTemporaryVoice(db, guild.id, session.id, orphan.id))) {
        this.temporaryVoices.get(guild.id)?.add(orphan.id);
        this.ctx.record({
          guildId: guild.id,
          action: 'squad.voice.reserve',
          source: 'job',
          target: { type: 'channel', id: orphan.id },
          after: {
            squadId: session.squadId,
            sessionId: session.id,
            temporary: true,
            recovered: true,
          },
        });
        log.warn({ ...bindings, voiceChannelId: orphan.id }, 'voice temporário órfão adotado');
        const squad = await getSquad(db, guild.id, session.squadId);
        const fresh = await getSquadSession(db, guild.id, session.id);
        if (squad && fresh) await this.renderSession(guild, fresh, squad);
        resolved++;
        continue;
      }

      const outcome = await this.deleteTemporaryVoice(guild, orphan.id, bindings);
      if (outcome === 'keep') continue;
      if (isReserved(session)) await releaseSessionVoice(db, guild.id, session.id, this.ctx.date());
      if (outcome === 'deleted') {
        this.ctx.record({
          guildId: guild.id,
          action: 'squad.voice.release',
          source: 'job',
          target: { type: 'channel', id: orphan.id },
          after: { squadId: session.squadId, sessionId: session.id, temporary: true, orphan: true },
        });
        log.warn({ ...bindings, voiceChannelId: orphan.id }, 'voice temporário órfão apagado');
      }
      resolved++;
    }
    return resolved;
  }

  /**
   * O canal é um voice temporário de jogatina ainda de pé? Consulta o banco
   * só na primeira pergunta de cada guild.
   */
  async isTemporaryVoice(guildId: string, channelId: string): Promise<boolean> {
    let ids = this.temporaryVoices.get(guildId);
    if (!ids) {
      ids = new Set(await listLiveTemporaryVoiceIds(this.ctx.db, guildId));
      this.temporaryVoices.set(guildId, ids);
    }
    return ids.has(channelId);
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
    if (current.voiceTemporary && voiceChannelId) {
      const outcome = await this.deleteTemporaryVoice(guild, voiceChannelId, bindings);
      if (outcome === 'keep') return false;
      restored = outcome === 'deleted';
    } else if (voiceChannelId && voiceOverwrites) {
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
    if (current.voiceTemporary && voiceChannelId) {
      this.temporaryVoices.get(guild.id)?.delete(voiceChannelId);
    }
    // Sala devolvida depois do início é jogatina encerrada: a chamada sai com
    // ela. Antes do início, a sala volta ao pool por remarcação ou
    // cancelamento, e a chamada continua (o cancelamento a fecha por conta).
    if (isSessionOver(released, this.ctx.now())) {
      await this.ctx.parts.calls.close(guild, released);
    }
    if (restored && voiceChannelId) {
      this.ctx.record({
        guildId: guild.id,
        action: 'squad.voice.release',
        source: 'job',
        target: { type: 'channel', id: voiceChannelId },
        after: {
          squadId: released.squadId,
          sessionId: released.id,
          ...(current.voiceTemporary ? { temporary: true } : {}),
        },
      });
    }
    return true;
  }

  /**
   * Apaga o voice temporário de uma reserva. `'keep'` quando ainda não dá:
   * tem gente dentro (a jogatina passou da hora, mas ninguém é expulso de uma
   * partida; o job tenta de novo a cada 5 min e o evento de voz, na saída do
   * último) ou o Discord falhou por outro motivo que não canal inexistente.
   * `'gone'` quando o canal já não existia.
   */
  private async deleteTemporaryVoice(
    guild: Guild,
    voiceChannelId: string,
    bindings: Record<string, unknown>,
  ): Promise<'deleted' | 'gone' | 'keep'> {
    const voice = await this.voiceForRelease(guild, voiceChannelId);
    if (voice === 'retry') return 'keep';
    if (!voice) return 'gone';
    if (
      voice.type === ChannelType.GuildVoice &&
      (voice as VoiceChannel).members.some((member) => !member.user.bot)
    ) {
      return 'keep';
    }
    try {
      await voice.delete('Fim da jogatina do squad');
      return 'deleted';
    } catch (error) {
      if (discordErrorCode(error) === DISCORD_UNKNOWN_CHANNEL) return 'gone';
      log.warn(
        { err: error, ...bindings },
        'falha ao apagar o voice temporário; o job tenta de novo',
      );
      return 'keep';
    }
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
   * pessoa é do squad, é a prova mais forte de que o squad joga: a presença
   * entra no histórico, a jogatina rolou, vale como sinal de vida e desfaz o
   * aviso de inatividade. Convidado da jogatina também tem a presença contada
   * (tempo e formações), mas nada além disso: jogatina em que só apareceu
   * convidado não rolou para o squad. `true` quando contou.
   */
  async confirmPresence(guild: Guild, voiceChannelId: string, userId: string): Promise<boolean> {
    const { db } = this.ctx;
    const session = await getActiveSessionByVoice(db, guild.id, voiceChannelId, this.ctx.date());
    if (!session || session.cancelledAt) return false;
    const members = await this.memberIds(guild.id, session.squadId);
    const asGuest =
      !members.includes(userId) && (await this.guestIds(guild.id, session.id)).includes(userId);
    if (!asGuest && !members.includes(userId)) return false;
    const at = this.ctx.date();
    await openSessionAttendance(db, {
      guildId: guild.id,
      sessionId: session.id,
      userId,
      joinedAt: at,
      asGuest,
    });
    if (!asGuest) await this.markPlayed(guild.id, session, at);
    return true;
  }

  /**
   * Alguém saiu de um voice do pool: a presença aberta dela termina aqui.
   * Fecha por pessoa, e não pela jogatina do voice, porque a reserva pode já
   * ter sido liberada (e aí o voice não aponta mais para jogatina nenhuma).
   * Quem nem era do squad não tem presença aberta, e a `UPDATE` não pega nada.
   */
  async recordLeave(guild: Guild, userId: string): Promise<number> {
    return closeSessionAttendance(this.ctx.db, guild.id, userId, this.ctx.date());
  }

  /**
   * Acerta a presença com quem está em voice agora, para cobrir o que o
   * evento de voz não vê. Roda na reserva, no início e a cada passada do job.
   *
   * - Quem é do squad e está no voice reservado de uma jogatina viva (a mesma
   *   janela do evento: de `SQUAD_PRESENCE_LEAD_MS` antes do início até o fim),
   *   sem presença aberta nela, ganha uma a partir de agora. É quem já estava
   *   na sala quando a reserva saiu, ou quem entrou com o bot fora do ar.
   * - Presença aberta de quem não está mais no voice da jogatina dela fecha
   *   agora. É quem saiu com o bot fora do ar, e por isso o tempo dessa pessoa
   *   sai maior do que foi: a saída de verdade não chegou a ninguém.
   *
   * Quem continua no voice depois da liberação continua contando, como no
   * evento, que só fecha na saída. A exceção é o voice que já está na janela
   * de outra jogatina (a seguinte do squad, na mesma sala): a presença passa a
   * ser dessa, e a antiga fecha, senão as duas contariam o mesmo tempo.
   */
  async sweepPresence(guild: Guild): Promise<SweepResult> {
    const { db } = this.ctx;
    const guildId = guild.id;
    const now = this.ctx.now();
    const at = this.ctx.date();
    const channelOf = (userId: string) => guild.voiceStates.cache.get(userId)?.channelId ?? null;
    const result: SweepResult = { opened: 0, closed: 0 };

    const live = (await this.liveReservations(guildId)).filter(
      (session) =>
        session.voiceChannelId !== null &&
        !session.cancelledAt &&
        session.startsAt.getTime() - SQUAD_PRESENCE_LEAD_MS <= now &&
        now < session.endsAt.getTime(),
    );
    const holder = new Map(live.map((session) => [session.voiceChannelId, session.id]));

    const stillOpen = new Set<string>();
    for (const row of await listOpenAttendance(db, guildId)) {
      const voiceId = row.voiceChannelId;
      const here =
        voiceId !== null &&
        channelOf(row.userId) === voiceId &&
        (holder.get(voiceId) ?? row.sessionId) === row.sessionId;
      if (here) stillOpen.add(`${String(row.sessionId)}:${row.userId}`);
      else if (await closeAttendanceRow(db, guildId, row, at)) result.closed++;
    }

    const guests = await listSessionGuests(
      db,
      guildId,
      live.map((session) => session.id),
    );
    for (const session of live) {
      const inRoom = (userId: string) =>
        channelOf(userId) === session.voiceChannelId &&
        !stillOpen.has(`${String(session.id)}:${userId}`);
      const members = await this.memberIds(guildId, session.squadId);
      const arrived = members.filter(inRoom);
      const guestsArrived = guests
        .filter((guest) => guest.sessionId === session.id && !members.includes(guest.userId))
        .map((guest) => guest.userId)
        .filter(inRoom);
      for (const userId of [...arrived, ...guestsArrived]) {
        const asGuest = !arrived.includes(userId);
        const input = { guildId, sessionId: session.id, userId, joinedAt: at, asGuest };
        if (await openSessionAttendance(db, input)) result.opened++;
      }
      // Só membro faz a jogatina ter rolado, como no evento de voz.
      if (arrived.length > 0) await this.markPlayed(guildId, session, at);
    }

    if (result.opened > 0 || result.closed > 0) {
      log.info({ guildId, ...result }, 'presença acertada');
    }
    return result;
  }

  /** `sweepPresence` dentro de outro fluxo, que não pode cair por causa dela. */
  private async sweepSafely(guild: Guild): Promise<void> {
    await this.sweepPresence(guild).catch((error: unknown) => {
      log.warn({ err: error, guildId: guild.id }, 'falha na varredura de presença');
    });
  }

  /**
   * Alguém do squad no voice reservado: a jogatina rolou, e é o sinal de vida
   * mais forte do squad, que também desfaz o aviso de inatividade.
   */
  private async markPlayed(guildId: string, session: SquadSession, at: Date): Promise<void> {
    const { db } = this.ctx;
    await markSessionPlayed(db, guildId, session.id, at);
    await touchSquadConfirmed(db, guildId, session.squadId, at);
    await clearSquadWarned(db, guildId, session.squadId);
  }

  /**
   * O voice reservado esvaziou. Depois do início da jogatina, a reserva sai
   * antes do fim, para a sala voltar ao servidor; antes do início não, porque
   * o squad ainda está chegando. Jogatina cancelada libera a qualquer hora: é
   * o caso de alguém ter esperado no voice temporário quando ela foi
   * cancelada, e sem isto o canal ficaria de pé até o fim previsto. `true`
   * quando liberou.
   */
  async releaseIfEmpty(guild: Guild, voiceChannelId: string): Promise<boolean> {
    const session = await getActiveSessionByVoice(
      this.ctx.db,
      guild.id,
      voiceChannelId,
      this.ctx.date(),
    );
    if (!session) return false;
    if (!session.cancelledAt && session.startsAt.getTime() > this.ctx.now()) return false;
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

  /** Reedita a mensagem de uma jogatina com o estado atual (a chamada pública mudou). Nunca lança. */
  async refresh(guild: Guild, sessionId: number): Promise<void> {
    try {
      const session = await getSquadSession(this.ctx.db, guild.id, sessionId);
      if (!session) return;
      const squad = await getSquad(this.ctx.db, guild.id, session.squadId);
      if (squad) await this.renderSession(guild, session, squad);
    } catch (error) {
      log.warn({ err: error, guildId: guild.id, sessionId }, 'falha ao atualizar a jogatina');
    }
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

  /**
   * O jogo lido na hora, e não guardado na jogatina: party e tamanho do squad
   * só aparecem na mensagem, e mudar o jogo no painel deve valer para o que
   * ainda vai ser mostrado. `null` sem jogo, o que a cascata do banco não
   * deixa acontecer com o squad vivo.
   */
  private async game(guildId: string, squad: Squad): Promise<SquadGame | null> {
    return getSquadGame(this.ctx.db, guildId, squad.gameId);
  }

  private async memberIds(guildId: string, squadId: string): Promise<string[]> {
    return (await listSquadMembers(this.ctx.db, guildId, squadId)).map((member) => member.userId);
  }

  /** Os convidados avulsos da jogatina, na ordem em que foram trazidos. */
  private async guestIds(guildId: string, sessionId: number): Promise<string[]> {
    return (await listSessionGuests(this.ctx.db, guildId, [sessionId])).map(
      (guest) => guest.userId,
    );
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
    const [config, embedColor, memberIds, guestIds, game] = await Promise.all([
      this.ctx.config.get(guild.id, 'squads'),
      this.ctx.embedColor(guild.id),
      this.memberIds(guild.id, squad.id),
      this.guestIds(guild.id, session.id),
      this.game(guild.id, squad),
    ]);
    const now = this.ctx.now();
    const live = squad.status !== 'archived';
    const canCall =
      game !== null &&
      config.searchChannelId !== null &&
      live &&
      callBlocker(session, {
        now,
        memberCount: memberIds.length,
        guestCount: guestIds.length,
        game,
      }) === null;
    const canBringGuest =
      config.searchChannelId !== null &&
      live &&
      guestBlocker(session, {
        now,
        guestCount: guestIds.length,
        max: config.maxSessionGuests,
      }) === null;
    return sessionMessage({
      session,
      squad,
      memberIds,
      guestIds,
      partySize: game?.partySize ?? null,
      voiceChannelId: isReserved(session) ? session.voiceChannelId : null,
      voiceTemporary: isReserved(session) && session.voiceTemporary,
      canCall,
      canBringGuest,
      callChannelId: session.callMessageId ? session.callChannelId : null,
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
