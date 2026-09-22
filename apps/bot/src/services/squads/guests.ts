import {
  addSessionGuest,
  getSquad,
  getSquadGame,
  getSquadSession,
  listSessionGuests,
  listSquadMembers,
  removeSessionGuest,
  setSessionGuestThread,
} from '@goodbot/db';
import { isSessionOver, UserFacingError } from '@goodbot/shared';
import { ChannelType, ThreadAutoArchiveDuration } from 'discord.js';

import { log, logFailure } from './context';
import { guestInviteMessage, guestNoticeMessage, guestPickMessage } from './embeds';
import { renderGuestThreadName } from './slots';

import type { SquadContext } from './context';
import type { GuestNotice } from './embeds';
import type { InviteTarget } from './requests';
import type { Squad, SquadSession, SquadSessionGuest } from '@goodbot/db';
import type { AuditSource, SquadsConfig } from '@goodbot/shared';
import type { BaseMessageOptions, Guild, TextChannel, ThreadChannel } from 'discord.js';

export interface GuestSent {
  session: SquadSession;
  squad: Squad;
  guestId: string;
  threadId: string;
  /** O voice que o convidado já ganhou; `null` = a sala sai depois, ou não sai. */
  voiceChannelId: string | null;
}

/**
 * Por que uma jogatina não aceita convidado agora; `null` = aceita. É a mesma
 * regra que esconde o botão TRAZER CONVIDADO da mensagem da jogatina, para o
 * botão só aparecer quando funciona.
 */
export function guestBlocker(
  session: Pick<SquadSession, 'cancelledAt' | 'endsAt' | 'startedAt' | 'voiceReleasedAt'>,
  context: { now: number; guestCount: number; max: number },
): UserFacingError | null {
  if (context.max === 0) {
    return new UserFacingError('Convidado avulso está desligado neste servidor.', {
      code: 'GUESTS_DISABLED',
    });
  }
  if (session.cancelledAt) {
    return new UserFacingError('Esta jogatina foi cancelada.', { code: 'SESSION_CANCELLED' });
  }
  if (isSessionOver(session, context.now)) {
    return new UserFacingError('Esta jogatina já acabou.', { code: 'SESSION_ENDED' });
  }
  if (context.guestCount >= context.max) {
    const count = context.max === 1 ? 'um convidado' : `${String(context.max)} convidados`;
    return new UserFacingError(`A jogatina já tem ${count}, o máximo neste servidor.`, {
      code: 'GUEST_LIMIT',
    });
  }
  return null;
}

/**
 * Convidado avulso (TRAZER CONVIDADO): alguém de fora do squad que joga só uma
 * jogatina. Quem é do squad escolhe a pessoa num select, e ela ganha o voice
 * reservado como um membro, até a liberação, que devolve o voice ao que era
 * também para ela. O aviso vai numa thread privada do canal de busca com quem
 * trouxe, porque o convidado não vê o canal do squad; a mesma thread recebe o
 * início, a remarcação e o cancelamento.
 *
 * Convidado conta no tempo e nas formações, mas não é sinal de vida do squad,
 * não marca a jogatina como jogada e fica fora do histórico. O bot não o move
 * de voice: ele não pediu para ir.
 *
 * A trava é a linha em `squad_session_guests`, gravada com a jogatina travada
 * (o teto confere ali); a thread que não sai desfaz a linha.
 */
export class GuestService {
  constructor(private readonly ctx: SquadContext) {}

  /** O select do TRAZER CONVIDADO, depois de conferir que quem clicou pode trazer. */
  async pickMessage(guildId: string, sessionId: number, by: string): Promise<BaseMessageOptions> {
    const { config, session, squad, guests } = await this.load(guildId, sessionId, by);
    const blocked = guestBlocker(session, this.limits(config, guests.length));
    if (blocked) throw blocked;
    return guestPickMessage(session, squad);
  }

  /** A pessoa escolhida no select: grava, avisa na thread e dá o voice se a sala já saiu. */
  async bring(
    guild: Guild,
    sessionId: number,
    by: string,
    target: InviteTarget,
    source: AuditSource,
  ): Promise<GuestSent> {
    const { db } = this.ctx;
    const guildId = guild.id;
    const { config, session, squad, guests } = await this.load(guildId, sessionId, by);
    // O teto por último: quem já é convidado ouve isso, e não que lotou.
    const closed = guestBlocker(session, this.limits(config, 0));
    if (closed) throw closed;

    if (target.bot) {
      throw new UserFacingError('Bots não jogam jogatina.', { code: 'GUEST_BOT' });
    }
    const members = await listSquadMembers(db, guildId, squad.id);
    if (members.some((member) => member.userId === target.id)) {
      throw new UserFacingError('Essa pessoa já é do squad: basta ela apertar VOU.', {
        code: 'ALREADY_MEMBER',
      });
    }
    if (guests.some((guest) => guest.userId === target.id)) throw guestExists();
    const full = guestBlocker(session, this.limits(config, guests.length));
    if (full) throw full;
    if ((await this.ctx.isGuildMember(guild, target.id)) === false) {
      throw new UserFacingError('Essa pessoa não está no servidor.', { code: 'NOT_IN_GUILD' });
    }
    const search = await this.ctx.parts.matcher.searchChannel(guild, config);
    if (!search.ok) {
      throw new UserFacingError(
        'Não consigo avisar o convidado: o canal de busca não está configurado ou me faltam permissões para criar conversa privada nele. Peça a um admin para revisar.',
        { code: 'SEARCH_CHANNEL_UNAVAILABLE' },
      );
    }

    const added = await addSessionGuest(db, {
      guildId,
      sessionId: session.id,
      userId: target.id,
      invitedBy: by,
      max: config.maxSessionGuests,
      now: this.ctx.date(),
    });
    if (added.outcome === 'exists') throw guestExists();
    if (added.outcome !== 'added') throw await this.refusal(guildId, session, config);

    const threadId = await this.openThread(guild, search.channel, squad, added.guest);
    const current = (await getSquadSession(db, guildId, session.id)) ?? session;
    const granted = await this.ctx.parts.sessions.grantSessionVoice(
      guild,
      current,
      target.id,
      `Convidado para a jogatina do squad ${squad.name}`,
    );

    this.ctx.record({
      guildId,
      action: 'squad.session.guest',
      source,
      actor: by,
      target: { type: 'member', id: target.id },
      after: { squadId: squad.id, sessionId: session.id, threadId },
    });
    log.info({ guildId, sessionId: session.id, guestId: target.id }, 'convidado avulso trazido');
    await this.ctx.parts.sessions.refresh(guild, session.id);
    return {
      session: current,
      squad,
      guestId: target.id,
      threadId,
      voiceChannelId: granted ? current.voiceChannelId : null,
    };
  }

  /**
   * Avisa cada convidado da jogatina na thread dele: editar o convite não
   * notifica. Nunca lança; aviso que não sai fica no log.
   */
  async notify(guild: Guild, session: SquadSession, notice: GuestNotice): Promise<void> {
    const bindings = { guildId: guild.id, sessionId: session.id, notice: notice.kind };
    try {
      const guests = await listSessionGuests(this.ctx.db, guild.id, [session.id]);
      if (!guests.some((guest) => guest.threadId)) return;
      const squad = await getSquad(this.ctx.db, guild.id, session.squadId);
      if (!squad) return;
      for (const guest of guests) {
        const thread = guest.threadId ? await this.thread(guild, guest.threadId) : null;
        await thread
          ?.send(guestNoticeMessage({ guestId: guest.userId, squad, notice }))
          .catch(logFailure('não foi possível avisar o convidado', bindings));
      }
    } catch (error) {
      log.warn({ err: error, ...bindings }, 'falha ao avisar os convidados');
    }
  }

  /**
   * A thread do convite, com o convidado e quem trouxe. Qualquer falha desfaz
   * a linha e apaga a thread: convidado sem aviso só ocuparia o teto, e sem a
   * linha não há voice para dar. Quem trouxe fora da thread (sem acesso ao
   * canal de busca) não desfaz nada: o convite é para o convidado.
   */
  private async openThread(
    guild: Guild,
    channel: TextChannel,
    squad: Squad,
    guest: SquadSessionGuest,
  ): Promise<string> {
    const { db } = this.ctx;
    const bindings = { guildId: guild.id, sessionId: guest.sessionId, guestId: guest.userId };
    let thread: ThreadChannel | null = null;
    try {
      thread = await channel.threads.create({
        name: renderGuestThreadName(squad.name),
        type: ChannelType.PrivateThread,
        invitable: false,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: `Convidado para a jogatina do squad ${squad.name}`,
      });
      await thread.members.add(guest.userId);
      await thread.members
        .add(guest.invitedBy)
        .catch(logFailure('não foi possível pôr quem convidou na conversa', bindings));
      const session = await getSquadSession(db, guild.id, guest.sessionId);
      if (!session) throw new Error('jogatina sumiu enquanto o convite saía');
      await thread.send(await this.renderInvite(guild.id, session, squad, guest));
      await setSessionGuestThread(db, guild.id, guest.sessionId, guest.userId, thread.id);
      return thread.id;
    } catch (error) {
      log.warn({ err: error, ...bindings }, 'o convite do convidado não saiu');
      await removeSessionGuest(db, guild.id, guest.sessionId, guest.userId).catch(() => null);
      await thread?.delete('Convite de convidado não saiu').catch(() => null);
      throw new UserFacingError('Não consegui mandar o convite agora. Tente de novo mais tarde.', {
        code: 'GUEST_FAILED',
      });
    }
  }

  private async renderInvite(
    guildId: string,
    session: SquadSession,
    squad: Squad,
    guest: SquadSessionGuest,
  ): Promise<BaseMessageOptions> {
    const [config, embedColor, game] = await Promise.all([
      this.ctx.config.get(guildId, 'squads'),
      this.ctx.embedColor(guildId),
      getSquadGame(this.ctx.db, guildId, squad.gameId),
    ]);
    const reserved =
      session.voiceReservedAt !== null && session.voiceReleasedAt === null && !session.cancelledAt;
    return guestInviteMessage({
      guestId: guest.userId,
      invitedBy: guest.invitedBy,
      squad,
      game: game ?? { name: 'o jogo' },
      session,
      started: session.startedAt !== null,
      voiceChannelId: reserved ? session.voiceChannelId : null,
      voiceTemporary: reserved && session.voiceTemporary,
      reminderMinutesBefore: config.reminderMinutesBefore,
      embedColor,
    });
  }

  /**
   * A jogatina, o squad vivo e os convidados, com quem clicou conferido como
   * membro. Se a jogatina aceita convidado (viva, marcada ou rolando, e com
   * lugar no teto) é o `guestBlocker`: o botão confere antes de abrir o
   * select, e a gravação confere de novo com a jogatina travada.
   */
  private async load(
    guildId: string,
    sessionId: number,
    by: string,
  ): Promise<{
    config: SquadsConfig;
    session: SquadSession;
    squad: Squad;
    guests: SquadSessionGuest[];
  }> {
    const { db } = this.ctx;
    const config = await this.ctx.requireConfig(guildId);
    const session = await getSquadSession(db, guildId, sessionId);
    if (!session) {
      throw new UserFacingError('Esta jogatina não existe mais.', { code: 'SESSION_NOT_FOUND' });
    }
    const squad = await getSquad(db, guildId, session.squadId);
    if (!squad || squad.status === 'archived') {
      throw new UserFacingError('Este squad foi encerrado.', { code: 'SQUAD_ARCHIVED' });
    }
    await this.ctx.parts.squads.assertMember(guildId, squad.id, by, 'trazer convidado');
    const guests = await listSessionGuests(db, guildId, [session.id]);
    return { config, session, squad, guests };
  }

  private limits(config: SquadsConfig, guestCount: number) {
    return { now: this.ctx.now(), guestCount, max: config.maxSessionGuests };
  }

  /** O motivo de a gravação ter recusado, lido de novo: cancelada, acabou ou teto cheio. */
  private async refusal(
    guildId: string,
    session: SquadSession,
    config: SquadsConfig,
  ): Promise<UserFacingError> {
    const { db } = this.ctx;
    const fresh = (await getSquadSession(db, guildId, session.id)) ?? session;
    const guests = await listSessionGuests(db, guildId, [session.id]);
    return (
      guestBlocker(fresh, this.limits(config, guests.length)) ??
      new UserFacingError(
        'Não consegui trazer o convidado agora. Tente de novo em alguns minutos.',
        {
          code: 'GUEST_BUSY',
        },
      )
    );
  }

  private async thread(guild: Guild, threadId: string): Promise<ThreadChannel | null> {
    const channel = await this.ctx.fetchChannel(guild, threadId);
    return channel?.isThread() ? channel : null;
  }
}

function guestExists(): UserFacingError {
  return new UserFacingError('Essa pessoa já é convidada desta jogatina.', {
    code: 'GUEST_EXISTS',
  });
}
