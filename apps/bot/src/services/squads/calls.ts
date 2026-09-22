import {
  claimSessionCall,
  closeSessionCall,
  getSquad,
  getSquadSession,
  listOpenSessionCalls,
  listSessionGuests,
  listSquadMembers,
  listUpcomingSessions,
  releaseSessionCall,
  setSessionCallMessage,
} from '@goodbot/db';
import { isSessionOver, UserFacingError } from '@goodbot/shared';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

import { discordErrorCode, log } from './context';
import { publicCallMessage } from './embeds';

import type { SquadContext } from './context';
import type { Squad, SquadGame, SquadSession } from '@goodbot/db';
import type { AuditSource, SquadsConfig } from '@goodbot/shared';
import type { Guild, TextChannel } from 'discord.js';

/** O que a chamada pública precisa no canal de busca: é uma mensagem com embed e botão. */
export const CALL_REQUIRED_BITS =
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.EmbedLinks;

/** `DiscordAPIError` de mensagem inexistente: alguém já apagou a chamada. */
const DISCORD_UNKNOWN_MESSAGE = 10008;

export interface CallSent {
  session: SquadSession;
  squad: Squad;
  channelId: string;
  messageId: string;
}

/**
 * Por que uma jogatina não aceita chamada agora; `null` = aceita. É a mesma
 * regra que esconde o botão CHAMAR GENTE da mensagem da jogatina, para o botão
 * só aparecer quando funciona. Convidado avulso ocupa lugar na party como
 * quem disse "vou".
 *
 * A chamada vale até o fim da jogatina, e não até o início: falta gente é o
 * que se descobre jogando, e quem entra no meio ainda pega partida (a sala
 * reservada é liberada para quem entra, ver `grantLiveVoice`).
 */
export function callBlocker(
  session: Pick<
    SquadSession,
    'endsAt' | 'startedAt' | 'voiceReleasedAt' | 'cancelledAt' | 'calledAt' | 'goingIds'
  >,
  context: {
    now: number;
    memberCount: number;
    guestCount: number;
    game: Pick<SquadGame, 'groupSize' | 'partySize'>;
  },
): UserFacingError | null {
  if (session.cancelledAt) {
    return new UserFacingError('Esta jogatina foi cancelada.', { code: 'SESSION_CANCELLED' });
  }
  if (isSessionOver(session, context.now)) {
    return new UserFacingError('Esta jogatina já acabou: a chamada é para quem ainda vai jogar.', {
      code: 'SESSION_ENDED',
    });
  }
  if (session.calledAt) {
    return new UserFacingError('Esta jogatina já tem uma chamada aberta no canal de busca.', {
      code: 'CALL_EXISTS',
    });
  }
  if (context.memberCount >= context.game.groupSize) {
    return new UserFacingError(
      'O squad está completo: não cabe gente de fora. Se sobrar lugar na party, quem é do squad ainda pode ir.',
      { code: 'SQUAD_FULL' },
    );
  }
  if (session.goingIds.length + context.guestCount >= context.game.partySize) {
    return new UserFacingError(
      `A party desta jogatina já fechou: cada partida leva até ${String(context.game.partySize)}.`,
      { code: 'PARTY_FULL' },
    );
  }
  return null;
}

/**
 * CHAMAR GENTE: a jogatina de um squad anunciada no canal de busca, com
 * ENTRAR para quem não é do squad. Uma chamada por jogatina, antes ou durante
 * ela, e sai do ar quando a jogatina acaba (`ends_at` ou a reserva liberada
 * depois do início) ou é cancelada. Quem aperta ENTRAR vira pedido de entrada
 * em votação (ver `SearchService.requestFromCall`).
 *
 * A trava é `called_at`, gravado antes de postar; a mensagem que não saiu
 * desfaz a trava, para dar para chamar de novo.
 */
export class CallService {
  constructor(private readonly ctx: SquadContext) {}

  /** O botão da mensagem da jogatina. */
  async call(guild: Guild, sessionId: number, by: string, source: AuditSource): Promise<CallSent> {
    const { db } = this.ctx;
    const guildId = guild.id;
    const config = await this.ctx.requireConfig(guildId);
    const session = await getSquadSession(db, guildId, sessionId);
    if (!session) {
      throw new UserFacingError('Esta jogatina não existe mais.', { code: 'SESSION_NOT_FOUND' });
    }
    const squad = await this.requireLiveSquad(guildId, session.squadId);
    await this.ctx.parts.squads.assertMember(guildId, squad.id, by, 'chamar gente');
    const game = await this.ctx.parts.profiles.requireGame(guildId, squad.gameId);
    const members = await listSquadMembers(db, guildId, squad.id);
    const guestCount = (await listSessionGuests(db, guildId, [session.id])).length;
    const blocked = callBlocker(session, {
      now: this.ctx.now(),
      memberCount: members.length,
      guestCount,
      game,
    });
    if (blocked) throw blocked;
    const channel = await this.searchChannel(guild, config);

    const claimed = await claimSessionCall(db, guildId, session.id, this.ctx.date());
    if (!claimed) {
      const fresh = (await getSquadSession(db, guildId, session.id)) ?? session;
      throw (
        callBlocker(fresh, {
          now: this.ctx.now(),
          memberCount: members.length,
          guestCount,
          game,
        }) ??
        new UserFacingError('Esta jogatina já tem uma chamada aberta no canal de busca.', {
          code: 'CALL_EXISTS',
        })
      );
    }

    const bindings = { guildId, squadId: squad.id, sessionId: session.id };
    let messageId: string;
    try {
      const message = await channel.send(
        publicCallMessage({
          session: claimed,
          squad,
          game,
          memberCount: members.length,
          history: (await this.ctx.parts.history.one(guildId, squad.id)).text,
          embedColor: await this.ctx.embedColor(guildId),
        }),
      );
      messageId = message.id;
    } catch (error) {
      log.warn({ err: error, ...bindings }, 'a chamada pública não saiu');
      await releaseSessionCall(db, guildId, session.id).catch(() => null);
      throw new UserFacingError(
        'Não consegui postar a chamada no canal de busca agora. Tente de novo mais tarde.',
        { code: 'CALL_FAILED', cause: error },
      );
    }

    const saved = (await setSessionCallMessage(db, guildId, session.id, {
      channelId: channel.id,
      messageId,
    })) ?? { ...claimed, callChannelId: channel.id, callMessageId: messageId };
    this.ctx.record({
      guildId,
      action: 'squad.session.call',
      source,
      actor: by,
      target: { type: 'squad', id: squad.id },
      after: { sessionId: session.id, channelId: channel.id, messageId },
    });
    log.info(bindings, 'chamada pública postada');

    // A jogatina pode ter acabado ou sido cancelada enquanto a mensagem saía:
    // quem a encerrou não viu a mensagem para apagar.
    if (saved.cancelledAt || isSessionOver(saved, this.ctx.now())) {
      await this.close(guild, saved);
    } else {
      await this.ctx.parts.sessions.refresh(guild, saved.id);
    }
    return { session: saved, squad, channelId: channel.id, messageId };
  }

  /**
   * O botão do guia: a primeira jogatina que aceita chamada, a que está
   * rolando inclusive. Sem nenhuma que aceite, tenta a mais próxima, para a
   * pessoa ler o motivo.
   */
  async callNext(
    guild: Guild,
    squadId: string,
    by: string,
    source: AuditSource,
  ): Promise<CallSent> {
    const { db } = this.ctx;
    const guildId = guild.id;
    await this.ctx.requireConfig(guildId);
    const squad = await this.requireLiveSquad(guildId, squadId);
    await this.ctx.parts.squads.assertMember(guildId, squad.id, by, 'chamar gente');
    const game = await this.ctx.parts.profiles.requireGame(guildId, squad.gameId);
    const members = await listSquadMembers(db, guildId, squad.id);

    const now = this.ctx.now();
    // `listUpcomingSessions` já deixa de fora cancelada e passada do fim; a
    // que está rolando agora continua valendo, e é a primeira da lista.
    const upcoming = await listUpcomingSessions(db, guildId, this.ctx.date(), {
      squadIds: [squad.id],
    });
    const guests = await listSessionGuests(
      db,
      guildId,
      upcoming.map((session) => session.id),
    );
    const context = (session: SquadSession) => ({
      now,
      memberCount: members.length,
      guestCount: guests.filter((guest) => guest.sessionId === session.id).length,
      game,
    });
    const target =
      upcoming.find((session) => callBlocker(session, context(session)) === null) ?? upcoming[0];
    if (!target) {
      throw new UserFacingError(
        'Não há jogatina marcada para chamar gente. Marque uma com BORA primeiro.',
        { code: 'NO_SESSION' },
      );
    }
    return this.call(guild, target.id, by, source);
  }

  /**
   * Tira a chamada do ar: apaga a mensagem do canal de busca. O banco vem
   * antes: início e cancelamento ao mesmo tempo apagam uma vez, e uma falha do
   * Discord deixa o botão ENTRAR no ar sem estrago, porque ele confere a
   * jogatina e responde que a chamada acabou. Nunca lança; `true` quando tirou.
   */
  async close(guild: Guild, session: SquadSession): Promise<boolean> {
    const { callMessageId, callChannelId } = session;
    if (!callMessageId) return false;
    const bindings = { guildId: guild.id, sessionId: session.id };
    try {
      const closed = await closeSessionCall(this.ctx.db, guild.id, session.id, callMessageId);
      if (!closed) return false;
      const channel = callChannelId ? await this.ctx.fetchChannel(guild, callChannelId) : null;
      if (channel?.type === ChannelType.GuildText) {
        await (channel as TextChannel).messages.delete(callMessageId).catch((error: unknown) => {
          if (discordErrorCode(error) === DISCORD_UNKNOWN_MESSAGE) return;
          log.warn({ err: error, ...bindings }, 'não foi possível apagar a chamada pública');
        });
      }
      return true;
    } catch (error) {
      log.warn({ err: error, ...bindings }, 'falha ao tirar a chamada pública do ar');
      return false;
    }
  }

  /**
   * Passo do job: tira do ar a chamada de toda jogatina que acabou. É o que
   * fecha a chamada no `ends_at`, porque nada mais acontece nesse minuto: o
   * início não fecha mais (a chamada vale durante a jogatina) e a liberação da
   * reserva só chega quando há sala. Nunca lança; devolve quantas tirou.
   */
  async closeFinished(guild: Guild): Promise<number> {
    let closed = 0;
    try {
      const now = this.ctx.now();
      for (const session of await listOpenSessionCalls(this.ctx.db, guild.id)) {
        if (!session.cancelledAt && !isSessionOver(session, now)) continue;
        if (await this.close(guild, session)) closed++;
      }
    } catch (error) {
      log.warn({ err: error, guildId: guild.id }, 'falha ao tirar as chamadas encerradas do ar');
    }
    return closed;
  }

  /**
   * Reedita a chamada no ar com a jogatina de agora: a remarcação muda o
   * horário que ela anuncia, e o início troca o texto para "rolando agora".
   * Nunca lança; chamada que sumiu fica para o ENTRAR, que já responde que
   * ela acabou.
   */
  async refreshMessage(guild: Guild, session: SquadSession): Promise<void> {
    const { callMessageId, callChannelId } = session;
    if (!callMessageId || !callChannelId) return;
    const guildId = guild.id;
    const bindings = { guildId, sessionId: session.id };
    try {
      const squad = await getSquad(this.ctx.db, guildId, session.squadId);
      const channel = await this.ctx.fetchChannel(guild, callChannelId);
      if (!squad || channel?.type !== ChannelType.GuildText) return;
      const [game, members, history, embedColor] = await Promise.all([
        this.ctx.parts.profiles.requireGame(guildId, squad.gameId),
        listSquadMembers(this.ctx.db, guildId, squad.id),
        this.ctx.parts.history.one(guildId, squad.id),
        this.ctx.embedColor(guildId),
      ]);
      await (channel as TextChannel).messages.edit(
        callMessageId,
        publicCallMessage({
          session,
          squad,
          game,
          memberCount: members.length,
          history: history.text,
          embedColor,
        }),
      );
    } catch (error) {
      if (discordErrorCode(error) === DISCORD_UNKNOWN_MESSAGE) return;
      log.warn({ err: error, ...bindings }, 'não foi possível atualizar a chamada pública');
    }
  }

  /** Squad arquivado: as chamadas dele saem do ar. Nunca lança. */
  async closeForSquad(guild: Guild, squadId: string): Promise<void> {
    try {
      const open = await listOpenSessionCalls(this.ctx.db, guild.id, { squadId });
      for (const session of open) await this.close(guild, session);
    } catch (error) {
      log.warn({ err: error, guildId: guild.id, squadId }, 'falha ao tirar as chamadas do squad');
    }
  }

  /** O canal de busca, se o bot consegue postar nele; senão um erro que diz o que falta. */
  private async searchChannel(
    guild: Guild,
    config: Pick<SquadsConfig, 'searchChannelId'>,
  ): Promise<TextChannel> {
    const unavailable = () =>
      new UserFacingError(
        'Não consigo postar no canal de busca: ele não está configurado ou me faltam permissões nele. Peça a um admin para revisar.',
        { code: 'SEARCH_CHANNEL_UNAVAILABLE' },
      );
    if (!config.searchChannelId) throw unavailable();
    const found = await this.ctx.fetchChannel(guild, config.searchChannelId);
    if (found?.type !== ChannelType.GuildText) throw unavailable();
    const channel = found as TextChannel;
    const me = guild.members.me;
    const permissions = me ? channel.permissionsFor(me) : null;
    if (!permissions?.has(CALL_REQUIRED_BITS)) {
      log.warn(
        {
          guildId: guild.id,
          channelId: channel.id,
          missing: permissions?.missing(CALL_REQUIRED_BITS) ?? [],
        },
        'chamada pública pulada: faltam permissões no canal de busca',
      );
      throw unavailable();
    }
    return channel;
  }

  private async requireLiveSquad(guildId: string, squadId: string): Promise<Squad> {
    const squad = await getSquad(this.ctx.db, guildId, squadId);
    if (!squad || squad.status === 'archived') {
      throw new UserFacingError('Este squad foi encerrado.', { code: 'SQUAD_ARCHIVED' });
    }
    return squad;
  }
}
