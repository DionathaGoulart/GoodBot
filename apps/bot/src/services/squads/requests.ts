import {
  countSquadsForUser,
  createSquadJoinRequest,
  decideSquadJoinRequest,
  getSquad,
  getSquadGame,
  getSquadJoinRequest,
  getSquadProfile,
  getSquadSession,
  listDueJoinRequests,
  listOpenJoinRequests,
  listRecentJoinRequestsFor,
  listSquadMembers,
  setSquadJoinRequestInvite,
  setSquadJoinRequestMessage,
  startSquadJoinVote,
  voteSquadJoinRequest,
} from '@goodbot/db';
import {
  bestSlot,
  DAY_MS,
  decideJoinVote,
  HOUR_MS,
  isSessionOver,
  isUserFacingError,
  UserFacingError,
} from '@goodbot/shared';
import { ChannelType, ThreadAutoArchiveDuration } from 'discord.js';

import { log, logFailure } from './context';
import { candidateNoticeMessage, inviteMessage, joinVoteMessage } from './embeds';
import { renderInviteThreadName } from './slots';

import type { SquadContext } from './context';
import type { InviteState, JoinVoteState } from './embeds';
import type { Squad, SquadJoinRequest, SquadMember } from '@goodbot/db';
import type { AuditSource, SquadOpenRequestStatus, SquadRequestStatus } from '@goodbot/shared';
import type { BaseMessageOptions, Guild, TextChannel, ThreadChannel } from 'discord.js';

export type InviteResult =
  | { outcome: 'sent'; request: SquadJoinRequest }
  /** A pessoa já tinha convite ou pedido aberto para este squad. */
  | { outcome: 'exists' }
  /** O Discord recusou a thread ou a mensagem; nada ficou aberto. */
  | { outcome: 'failed' };

export type InviteAnswer =
  /** Convite de membro: entrou na hora. */
  | { outcome: 'joined'; squad: Squad }
  /** Convite do matcher: o pedido foi para a votação do squad. */
  | { outcome: 'voting'; squad: Squad }
  | { outcome: 'passed' }
  | { outcome: 'already'; status: SquadRequestStatus };

export type JoinVoteResult =
  /** Voto gravado; a votação segue. */
  | { outcome: 'recorded'; inFavor: boolean }
  /** O membro já tinha votado assim. */
  | { outcome: 'unchanged' }
  /** O voto fechou a votação e a pessoa entrou. */
  | { outcome: 'accepted'; squad: Squad }
  | { outcome: 'declined' }
  /** O voto fechou a votação, mas a vaga já não existia. */
  | { outcome: 'closed' }
  | { outcome: 'already'; status: SquadRequestStatus };

export interface MemberInviteSent {
  request: SquadJoinRequest;
  squad: Squad;
}

/** Quem o membro quer convidar, como o Discord entrega (comando ou select). */
export interface InviteTarget {
  id: string;
  bot: boolean;
}

/** O que a regra do voto fez com um pedido em votação. */
type Settled =
  | { outcome: 'open' | 'declined' | 'expired' | 'closed' }
  | { outcome: 'joined'; squad: Squad }
  | { outcome: 'already'; status: SquadRequestStatus };

/** Como o fim de um pedido aparece nas duas mensagens: a votação e o convite. */
interface FinishStates {
  vote?: JoinVoteState;
  invite: InviteState;
}

/**
 * Entrada num squad que já existe, em duas fases.
 *
 * 1. **Convite.** O matcher (ou um membro) convida numa thread privada do
 *    canal de busca, só com o candidato, que vê o squad e responde ENTRAR ou
 *    PASSO. Quem pede pelo `/squad procurar` pula esta fase: o clique já é o
 *    aceite.
 * 2. **Votação.** O pedido vai para o canal do squad com A FAVOR / CONTRA, e
 *    `decideJoinVote` (em `shared`) decide com os membros de agora. Convite de
 *    membro não passa por aqui: entra no ENTRAR.
 *
 * Toda passagem de fase é uma `UPDATE` condicional antes de qualquer chamada
 * ao Discord, e as mensagens são consequência: falha ao editá-las fica no log.
 */
export class JoinRequestService {
  constructor(private readonly ctx: SquadContext) {}

  /**
   * O convite. A linha vem primeiro porque o índice de "um aberto por pessoa e
   * squad" é a trava contra dois convites iguais; depois a thread e a
   * mensagem, que já nasce com os botões. Falha no Discord encerra a linha e
   * apaga a thread: convite sem botão só seguraria a vaga.
   */
  async invite(
    guild: Guild,
    channel: TextChannel,
    squad: Squad,
    candidateId: string,
    options: { invitedBy: string | null },
  ): Promise<InviteResult> {
    const { db } = this.ctx;
    const request = await createSquadJoinRequest(db, {
      guildId: guild.id,
      squadId: squad.id,
      userId: candidateId,
      status: 'invited',
      invitedBy: options.invitedBy,
      expiresAt: await this.deadline(guild.id),
    });
    if (!request) return { outcome: 'exists' };

    const bindings = { guildId: guild.id, squadId: squad.id, requestId: request.id };
    let thread: ThreadChannel | null = null;
    try {
      thread = await channel.threads.create({
        name: renderInviteThreadName(squad.name),
        type: ChannelType.PrivateThread,
        invitable: false,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: `Convite para o squad ${squad.name}`,
      });
      await thread.members.add(candidateId);
      const message = await thread.send(
        await this.renderInvite(guild.id, request, squad, 'invited', true),
      );
      const saved = await setSquadJoinRequestInvite(db, guild.id, request.id, {
        threadId: thread.id,
        inviteMessageId: message.id,
      });
      log.info(
        { ...bindings, source: options.invitedBy ? 'member' : 'matcher' },
        'convite para squad enviado',
      );
      return {
        outcome: 'sent',
        request: saved ?? { ...request, threadId: thread.id, inviteMessageId: message.id },
      };
    } catch (error) {
      log.warn({ err: error, ...bindings }, 'convite para squad não saiu');
      await this.abandon(guild.id, request.id);
      await thread?.delete('Convite para squad não saiu').catch(() => null);
      return { outcome: 'failed' };
    }
  }

  /**
   * O pedido do `/squad procurar` e do ENTRAR de uma chamada pública: já nasce
   * na votação, sem convite. `sessionId` é a jogatina da chamada.
   */
  async open(
    guild: Guild,
    squad: Squad,
    candidateId: string,
    options: { sessionId?: number } = {},
  ): Promise<InviteResult> {
    const request = await createSquadJoinRequest(this.ctx.db, {
      guildId: guild.id,
      squadId: squad.id,
      userId: candidateId,
      status: 'pending',
      sessionId: options.sessionId ?? null,
      expiresAt: await this.deadline(guild.id),
    });
    if (!request) return { outcome: 'exists' };
    const bindings = { guildId: guild.id, squadId: squad.id, requestId: request.id };
    try {
      const posted = await this.postVote(guild, request, squad);
      log.info(
        { ...bindings, source: options.sessionId ? 'call' : 'search' },
        'pedido de entrada em votação',
      );
      return { outcome: 'sent', request: posted };
    } catch (error) {
      log.warn({ err: error, ...bindings }, 'pedido de entrada sem mensagem');
      await this.abandon(guild.id, request.id);
      return { outcome: 'failed' };
    }
  }

  /**
   * `/squad convidar` e o CONVIDAR do guia. É convite de dentro: não exige
   * grade compatível nem passa por voto, mas respeita vaga, teto de squads e
   * o "não" recente da própria pessoa a este squad.
   */
  async inviteByMember(
    guild: Guild,
    squadId: string,
    inviterId: string,
    target: InviteTarget,
    source: AuditSource,
  ): Promise<MemberInviteSent> {
    const { db } = this.ctx;
    const config = await this.ctx.requireConfig(guild.id);
    const squad = await getSquad(db, guild.id, squadId);
    if (!squad || squad.status === 'archived') {
      throw new UserFacingError('Este squad foi encerrado.', { code: 'SQUAD_ARCHIVED' });
    }
    await this.ctx.parts.squads.assertMember(guild.id, squad.id, inviterId, 'convidar gente');
    const game = await this.ctx.parts.profiles.requireGame(guild.id, squad.gameId);

    if (target.bot) {
      throw new UserFacingError('Bots não entram em squad.', { code: 'INVITE_BOT' });
    }
    const members = await listSquadMembers(db, guild.id, squad.id);
    if (members.some((member) => member.userId === target.id)) {
      throw new UserFacingError('Essa pessoa já está no squad.', { code: 'ALREADY_MEMBER' });
    }
    if (members.length >= game.groupSize) {
      throw new UserFacingError('O squad já está completo.', { code: 'SQUAD_FULL' });
    }
    if ((await countSquadsForUser(db, guild.id, target.id)) >= config.maxSquadsPerUser) {
      throw new UserFacingError('Essa pessoa já está no máximo de squads deste servidor.', {
        code: 'SQUAD_LIMIT',
      });
    }
    if ((await this.ctx.isGuildMember(guild, target.id)) === false) {
      throw new UserFacingError('Essa pessoa não está no servidor.', { code: 'NOT_IN_GUILD' });
    }
    const since = new Date(this.ctx.now() - config.reproposeCooldownDays * DAY_MS);
    const recent = await listRecentJoinRequestsFor(db, guild.id, squad.id, target.id, since);
    if (
      recent.some((request) => request.status === 'declined' && request.decidedBy === target.id)
    ) {
      throw new UserFacingError(
        'Essa pessoa passou num convite deste squad há pouco tempo. Combine com ela antes de chamar de novo.',
        { code: 'INVITE_COOLDOWN' },
      );
    }

    const search = await this.ctx.parts.matcher.searchChannel(guild, config);
    if (!search.ok) {
      throw new UserFacingError(
        'Não consigo abrir o convite: o canal de busca não está configurado ou me faltam permissões para criar conversa privada nele. Peça a um admin para revisar.',
        { code: 'SEARCH_CHANNEL_UNAVAILABLE' },
      );
    }
    // Na mesma fila do matcher, que também convida para as vagas deste jogo.
    const sent = await this.ctx.parts.matcher.withGameLock(guild.id, game.id, () =>
      this.invite(guild, search.channel, squad, target.id, { invitedBy: inviterId }),
    );
    if (sent.outcome === 'exists') {
      throw new UserFacingError('Essa pessoa já tem um convite ou pedido aberto para este squad.', {
        code: 'REQUEST_PENDING',
      });
    }
    if (sent.outcome === 'failed') {
      throw new UserFacingError('Não consegui mandar o convite agora. Tente de novo mais tarde.', {
        code: 'REQUEST_FAILED',
      });
    }

    this.ctx.record({
      guildId: guild.id,
      action: 'squad.member.invite',
      source,
      actor: inviterId,
      target: { type: 'member', id: target.id },
      after: { squadId: squad.id, requestId: sent.request.id },
    });
    return { request: sent.request, squad };
  }

  /** ENTRAR ou PASSO, na thread do convite. */
  async answer(
    guild: Guild,
    requestId: string,
    userId: string,
    accept: boolean,
  ): Promise<InviteAnswer> {
    const config = await this.ctx.requireConfig(guild.id);
    const { request, squad } = await this.loadForCandidate(guild.id, requestId, userId);
    if (request.status !== 'invited') return { outcome: 'already', status: request.status };
    if (request.expiresAt.getTime() <= this.ctx.now()) {
      await this.close(guild, request, squad, { invite: 'expired' }, ['invited']);
      return { outcome: 'already', status: 'expired' };
    }

    if (!accept) {
      const passed = await decideSquadJoinRequest(this.ctx.db, guild.id, request.id, {
        status: 'declined',
        decidedBy: userId,
        at: this.ctx.date(),
        from: ['invited'],
      });
      if (!passed) return this.already(guild.id, request.id);
      await this.finish(guild, passed, squad, { invite: 'passed' });
      return { outcome: 'passed' };
    }

    if (squad.status === 'archived') {
      await this.close(guild, request, squad, { invite: 'closed' }, ['invited']);
      throw new UserFacingError('Este squad foi encerrado.', { code: 'SQUAD_ARCHIVED' });
    }
    // O teto é da pessoa, não da vaga: quem sair de outro squad ainda aceita no prazo.
    await this.ctx.parts.squads.assertCanJoinAnother(guild.id, userId, config);

    if (request.invitedBy) {
      const settled = await this.admit(guild, request, squad, userId, request.invitedBy);
      if (settled.outcome === 'joined') return { outcome: 'joined', squad: settled.squad };
      if (settled.outcome === 'already') return settled;
      throw this.vacancyGone();
    }
    return this.startVote(guild, request, squad, config.proposalTtlHours);
  }

  /** A FAVOR ou CONTRA, na votação do canal do squad. */
  async vote(
    guild: Guild,
    requestId: string,
    memberId: string,
    inFavor: boolean,
  ): Promise<JoinVoteResult> {
    const { db } = this.ctx;
    await this.ctx.requireConfig(guild.id);
    const { request, squad, members } = await this.loadForMember(guild.id, requestId, memberId);
    if (request.status !== 'pending') return { outcome: 'already', status: request.status };
    const memberIds = members.map((member) => member.userId);
    if (request.expiresAt.getTime() <= this.ctx.now()) {
      await this.settle(guild, request, squad, memberIds, { expired: true, decidedBy: null });
      return this.already(guild.id, request.id);
    }

    const voted = await voteSquadJoinRequest(db, guild.id, request.id, memberId, inFavor);
    if (!voted) {
      const fresh = await getSquadJoinRequest(db, guild.id, request.id);
      return fresh?.status === 'pending'
        ? { outcome: 'unchanged' }
        : { outcome: 'already', status: fresh?.status ?? 'expired' };
    }

    const settled = await this.settle(guild, voted, squad, memberIds, {
      expired: false,
      decidedBy: memberId,
    });
    switch (settled.outcome) {
      case 'open':
        return { outcome: 'recorded', inFavor };
      case 'joined':
        return { outcome: 'accepted', squad: settled.squad };
      case 'declined':
      case 'closed':
        return { outcome: settled.outcome };
      case 'expired':
        return { outcome: 'already', status: 'expired' };
      case 'already':
        return settled;
    }
  }

  /**
   * O prazo de cada pedido aberto, pelo job: convite sem resposta expira em
   * silêncio; votação vencida decide com os votos que tem. Devolve quantos
   * pedidos fecharam.
   */
  async expireDue(guildId: string): Promise<number> {
    const { db } = this.ctx;
    const guild = this.ctx.client.guilds.cache.get(guildId);
    if (!guild) return 0;
    const due = await listDueJoinRequests(db, guildId, this.ctx.date());
    let closed = 0;
    for (const request of due) {
      try {
        const squad = await getSquad(db, guildId, request.squadId);
        if (!squad) continue;
        if (request.status === 'invited') {
          if (await this.close(guild, request, squad, { invite: 'expired' }, ['invited'])) closed++;
          continue;
        }
        const memberIds = (await listSquadMembers(db, guildId, squad.id)).map((m) => m.userId);
        const settled = await this.settle(guild, request, squad, memberIds, {
          expired: true,
          decidedBy: null,
        });
        if (settled.outcome !== 'open' && settled.outcome !== 'already') closed++;
      } catch (error) {
        log.warn({ err: error, guildId, requestId: request.id }, 'falha ao vencer o pedido');
      }
    }
    return closed;
  }

  /** Squad arquivado: convites e votações abertos dele morrem junto. */
  async expireForSquad(guild: Guild, squad: Squad): Promise<void> {
    try {
      const open = await listOpenJoinRequests(this.ctx.db, guild.id, squad.id);
      for (const request of open) {
        await this.close(guild, request, squad, { vote: 'closed', invite: 'closed' });
      }
    } catch (error) {
      log.warn(
        { err: error, guildId: guild.id, squadId: squad.id },
        'falha ao encerrar pedidos do squad',
      );
    }
  }

  /**
   * Alguém saiu do squad: as votações abertas recontam com os membros que
   * ficaram, e o voto de quem saiu deixa de contar. Nunca lança.
   */
  async reevaluateForSquad(guild: Guild, squadId: string): Promise<void> {
    const { db } = this.ctx;
    try {
      const squad = await getSquad(db, guild.id, squadId);
      if (!squad || squad.status === 'archived') return;
      const voting = (await listOpenJoinRequests(db, guild.id, squadId)).filter(
        (request) => request.status === 'pending',
      );
      if (voting.length === 0) return;
      const memberIds = (await listSquadMembers(db, guild.id, squadId)).map((m) => m.userId);
      for (const request of voting) {
        await this.settle(guild, request, squad, memberIds, { expired: false, decidedBy: null });
      }
    } catch (error) {
      log.warn({ err: error, guildId: guild.id, squadId }, 'falha ao recontar votações do squad');
    }
  }

  // ── regra e passagens de fase ─────────────────────────────────────────────

  /** O candidato aceitou o convite do matcher: o pedido vai para a votação. */
  private async startVote(
    guild: Guild,
    request: SquadJoinRequest,
    squad: Squad,
    ttlHours: number,
  ): Promise<InviteAnswer> {
    const { db } = this.ctx;
    const voting = await startSquadJoinVote(
      db,
      guild.id,
      request.id,
      new Date(this.ctx.now() + ttlHours * HOUR_MS),
    );
    if (!voting) return this.already(guild.id, request.id);

    let posted: SquadJoinRequest;
    try {
      posted = await this.postVote(guild, voting, squad);
    } catch (error) {
      log.warn(
        { err: error, guildId: guild.id, requestId: request.id },
        'a votação do pedido não saiu no canal do squad',
      );
      await this.close(guild, voting, squad, { invite: 'closed' }, ['pending']);
      throw new UserFacingError(
        'Não consegui levar seu pedido ao squad agora, então o convite foi encerrado.',
        { code: 'REQUEST_FAILED' },
      );
    }
    await this.editInvite(guild, posted, squad, 'voting');
    // Trancada, a thread vira só o lugar do aviso: o candidato não escreve mais nela.
    await this.editThread(guild, posted.threadId, { locked: true });
    log.info({ guildId: guild.id, requestId: request.id }, 'convite aceito, squad votando');
    return { outcome: 'voting', squad };
  }

  /**
   * Aplica `decideJoinVote` a um pedido em votação. Aberto, só atualiza a
   * contagem; decidido, fecha e mostra o fim nas duas mensagens.
   */
  private async settle(
    guild: Guild,
    request: SquadJoinRequest,
    squad: Squad,
    memberIds: readonly string[],
    options: { expired: boolean; decidedBy: string | null },
  ): Promise<Settled> {
    const decision = decideJoinVote({
      memberIds,
      forIds: request.acceptedIds,
      againstIds: request.declinedIds,
      expired: options.expired,
    });
    switch (decision) {
      case 'open':
        await this.editVote(guild, request, squad, 'open');
        return { outcome: 'open' };
      case 'accepted':
        return this.admit(guild, request, squad, options.decidedBy, options.decidedBy);
      case 'declined':
      case 'expired': {
        const decided = await decideSquadJoinRequest(this.ctx.db, guild.id, request.id, {
          status: decision,
          decidedBy: decision === 'declined' ? options.decidedBy : null,
          at: this.ctx.date(),
          from: ['pending'],
        });
        if (!decided) return this.already(guild.id, request.id);
        await this.finish(guild, decided, squad, { vote: decision, invite: 'refused' });
        return { outcome: decision };
      }
    }
  }

  /**
   * Põe o candidato no squad. Vaga e teto são conferidos de novo, porque o
   * squad pode ter enchido desde o convite; sem eles o pedido fecha como
   * vaga indisponível. O `accepted` gravado antes da entrada é a trava contra
   * dois votos que fecham a votação juntos.
   */
  private async admit(
    guild: Guild,
    request: SquadJoinRequest,
    squad: Squad,
    decidedBy: string | null,
    actorId: string | null,
  ): Promise<Settled> {
    const { db } = this.ctx;
    const config = await this.ctx.config.get(guild.id, 'squads');
    const [game, members, squads] = await Promise.all([
      getSquadGame(db, guild.id, squad.gameId),
      listSquadMembers(db, guild.id, squad.id),
      countSquadsForUser(db, guild.id, request.userId),
    ]);
    if (!game || members.length >= game.groupSize || squads >= config.maxSquadsPerUser) {
      await this.close(guild, request, squad, { vote: 'closed', invite: 'closed' });
      return { outcome: 'closed' };
    }

    const decided = await decideSquadJoinRequest(db, guild.id, request.id, {
      status: 'accepted',
      decidedBy,
      at: this.ctx.date(),
    });
    if (!decided) return this.already(guild.id, request.id);

    try {
      await this.ctx.parts.profiles.ensureProfile(guild.id, request.userId, game.id);
      const { squad: joined } = await this.ctx.parts.squads.addMember(
        guild,
        squad.id,
        request.userId,
        { source: 'event', ping: true, ...(actorId ? { actorId } : {}) },
      );
      await this.finish(guild, decided, joined, { vote: 'accepted', invite: 'joined' });
      if (decided.sessionId) await this.goingAfterCall(guild, decided.sessionId, request.userId);
      return { outcome: 'joined', squad: joined };
    } catch (error) {
      if (isUserFacingError(error)) {
        await this.finish(guild, decided, squad, { vote: 'closed', invite: 'closed' });
      }
      throw error;
    }
  }

  /**
   * Quem entrou pela chamada pública de uma jogatina já fica como "vou" nela:
   * foi para jogar essa que a pessoa pediu. Jogatina que começou, acabou ou
   * foi cancelada enquanto o squad votava fica como está. Nunca lança.
   */
  private async goingAfterCall(guild: Guild, sessionId: number, userId: string): Promise<void> {
    try {
      await this.ctx.parts.sessions.vote(guild, sessionId, userId, true);
    } catch (error) {
      if (isUserFacingError(error)) return;
      log.warn(
        { err: error, guildId: guild.id, sessionId, userId },
        'não foi possível marcar presença na jogatina da chamada',
      );
    }
  }

  /** Fecha o pedido como `expired` e mostra o fim. `false` quando outra decisão chegou antes. */
  private async close(
    guild: Guild,
    request: SquadJoinRequest,
    squad: Squad,
    states: FinishStates,
    from?: readonly SquadOpenRequestStatus[],
  ): Promise<boolean> {
    const decided = await decideSquadJoinRequest(this.ctx.db, guild.id, request.id, {
      status: 'expired',
      decidedBy: null,
      at: this.ctx.date(),
      ...(from ? { from } : {}),
    });
    if (!decided) return false;
    await this.finish(guild, decided, squad, states);
    return true;
  }

  /** Pedido que não chegou ao Discord: fecha sem mensagem para mostrar. */
  private async abandon(guildId: string, requestId: string): Promise<void> {
    await decideSquadJoinRequest(this.ctx.db, guildId, requestId, {
      status: 'expired',
      decidedBy: null,
      at: this.ctx.date(),
    }).catch(() => null);
  }

  private async already(
    guildId: string,
    requestId: string,
  ): Promise<{
    outcome: 'already';
    status: SquadRequestStatus;
  }> {
    const fresh = await getSquadJoinRequest(this.ctx.db, guildId, requestId);
    return { outcome: 'already', status: fresh?.status ?? 'expired' };
  }

  private vacancyGone(): UserFacingError {
    return new UserFacingError(
      'A vaga no squad não está mais disponível, então o convite foi encerrado.',
      { code: 'SQUAD_FULL' },
    );
  }

  private async deadline(guildId: string): Promise<Date> {
    const config = await this.ctx.config.get(guildId, 'squads');
    return new Date(this.ctx.now() + config.proposalTtlHours * HOUR_MS);
  }

  private async loadForCandidate(
    guildId: string,
    requestId: string,
    userId: string,
  ): Promise<{ request: SquadJoinRequest; squad: Squad }> {
    const { db } = this.ctx;
    const request = await getSquadJoinRequest(db, guildId, requestId);
    if (!request) {
      throw new UserFacingError('Este convite não existe mais.', { code: 'REQUEST_NOT_FOUND' });
    }
    if (request.userId !== userId) {
      throw new UserFacingError('Este convite não é para você.', { code: 'NOT_INVITED' });
    }
    const squad = await getSquad(db, guildId, request.squadId);
    if (!squad) {
      throw new UserFacingError('Este squad foi encerrado.', { code: 'SQUAD_ARCHIVED' });
    }
    return { request, squad };
  }

  private async loadForMember(
    guildId: string,
    requestId: string,
    memberUserId: string,
  ): Promise<{ request: SquadJoinRequest; squad: Squad; members: SquadMember[] }> {
    const { db } = this.ctx;
    const request = await getSquadJoinRequest(db, guildId, requestId);
    if (!request) {
      throw new UserFacingError('Este pedido não existe mais.', { code: 'REQUEST_NOT_FOUND' });
    }
    const squad = await getSquad(db, guildId, request.squadId);
    if (!squad || squad.status === 'archived') {
      throw new UserFacingError('Este squad foi encerrado.', { code: 'SQUAD_ARCHIVED' });
    }
    const members = await listSquadMembers(db, guildId, squad.id);
    if (!members.some((member) => member.userId === memberUserId)) {
      throw new UserFacingError('Só quem é do squad vota neste pedido.', {
        code: 'NOT_A_MEMBER',
      });
    }
    return { request, squad, members };
  }

  // ── mensagens ─────────────────────────────────────────────────────────────

  /** Manda a votação ao canal do squad chamando os membros. Lança se o canal recusar. */
  private async postVote(
    guild: Guild,
    request: SquadJoinRequest,
    squad: Squad,
  ): Promise<SquadJoinRequest> {
    const channel = await this.ctx.textChannel(guild, squad);
    if (!channel) throw new Error('squad sem canal de texto');
    const message = await channel.send(
      await this.renderVote(guild.id, request, squad, 'open', true),
    );
    return (
      (await setSquadJoinRequestMessage(this.ctx.db, guild.id, request.id, message.id)) ?? {
        ...request,
        messageId: message.id,
      }
    );
  }

  /**
   * O fim de um pedido nas duas mensagens. Quem aceitou o convite e esperava
   * a votação ganha um aviso com menção quando não entrou: editar o convite
   * não notifica. A thread fecha em todo fim.
   */
  private async finish(
    guild: Guild,
    request: SquadJoinRequest,
    squad: Squad,
    states: FinishStates,
  ): Promise<void> {
    if (states.vote) await this.editVote(guild, request, squad, states.vote);
    if (!request.threadId) return;
    await this.editInvite(guild, request, squad, states.invite);
    const waited = request.messageId !== null;
    if (waited && (states.invite === 'refused' || states.invite === 'closed')) {
      const thread = await this.thread(guild, request.threadId);
      await thread
        ?.send(candidateNoticeMessage({ userId: request.userId, squad, state: states.invite }))
        .catch(
          logFailure('não foi possível avisar o candidato', {
            guildId: guild.id,
            requestId: request.id,
          }),
        );
    }
    await this.editThread(guild, request.threadId, { locked: true, archived: true });
  }

  private async renderVote(
    guildId: string,
    request: SquadJoinRequest,
    squad: Squad,
    state: JoinVoteState,
    mentionMembers: boolean,
  ): Promise<BaseMessageOptions> {
    const { db } = this.ctx;
    const [config, embedColor, game, profile, members, session] = await Promise.all([
      this.ctx.config.get(guildId, 'squads'),
      this.ctx.embedColor(guildId),
      getSquadGame(db, guildId, squad.gameId),
      getSquadProfile(db, guildId, request.userId, squad.gameId),
      listSquadMembers(db, guildId, squad.id),
      request.sessionId ? getSquadSession(db, guildId, request.sessionId) : null,
    ]);
    const memberProfiles = await Promise.all(
      members.map((member) => getSquadProfile(db, guildId, member.userId, squad.gameId)),
    );
    // A célula em que o candidato divide a grade com mais membros.
    const candidateMask = profile?.availability ?? 0;
    const slot = bestSlot(
      memberProfiles.flatMap((row) => (row ? [row.availability & candidateMask] : [])),
    );
    return joinVoteMessage({
      request,
      memberIds: members.map((member) => member.userId),
      game: { fields: game?.fields ?? [] },
      answers: profile?.answers ?? {},
      slot: slot ? { day: slot.day, block: slot.block } : null,
      session,
      blocks: config.blocks,
      state,
      embedColor,
      mentionMembers,
    });
  }

  private async renderInvite(
    guildId: string,
    request: SquadJoinRequest,
    squad: Squad,
    state: InviteState,
    mentionCandidate: boolean,
  ): Promise<BaseMessageOptions> {
    const { db } = this.ctx;
    const [embedColor, game, members, history] = await Promise.all([
      this.ctx.embedColor(guildId),
      getSquadGame(db, guildId, squad.gameId),
      listSquadMembers(db, guildId, squad.id),
      this.ctx.parts.history.one(guildId, squad.id),
    ]);
    return inviteMessage({
      request,
      squad,
      game: game ?? { name: 'o jogo', groupSize: members.length },
      memberIds: members.map((member) => member.userId),
      history: history.text,
      state,
      running: state === 'joined' ? await this.runningSession(guildId, request) : null,
      embedColor,
      mentionCandidate,
    });
  }

  /**
   * A jogatina da chamada que a pessoa respondeu, se ela está rolando agora:
   * quem entra no meio precisa saber em qual sala cair, e o canal do squad só
   * aparece para ela depois de entrar.
   */
  private async runningSession(
    guildId: string,
    request: SquadJoinRequest,
  ): Promise<{ voiceChannelId: string | null; voiceTemporary: boolean } | null> {
    if (!request.sessionId) return null;
    const session = await getSquadSession(this.ctx.db, guildId, request.sessionId);
    if (!session?.startedAt || session.cancelledAt) return null;
    if (isSessionOver(session, this.ctx.now())) return null;
    const reserved = session.voiceReservedAt !== null && session.voiceReleasedAt === null;
    return {
      voiceChannelId: reserved ? session.voiceChannelId : null,
      voiceTemporary: reserved && session.voiceTemporary,
    };
  }

  /** Reedita a votação; nunca lança. */
  private async editVote(
    guild: Guild,
    request: SquadJoinRequest,
    squad: Squad,
    state: JoinVoteState,
  ): Promise<void> {
    if (!request.messageId) return;
    const messageId = request.messageId;
    const bindings = { guildId: guild.id, requestId: request.id };
    try {
      const channel = await this.ctx.textChannel(guild, squad);
      const message = await channel?.messages.fetch(messageId).catch(() => null);
      if (!message) return;
      await message
        .edit(await this.renderVote(guild.id, request, squad, state, false))
        .catch(logFailure('não foi possível atualizar a votação do pedido', bindings));
    } catch (error) {
      log.warn({ err: error, ...bindings }, 'falha ao atualizar a votação do pedido');
    }
  }

  /** Reedita o convite; nunca lança. Thread arquivada não aceita edição, então reabre antes. */
  private async editInvite(
    guild: Guild,
    request: SquadJoinRequest,
    squad: Squad,
    state: InviteState,
  ): Promise<void> {
    if (!request.threadId || !request.inviteMessageId) return;
    const messageId = request.inviteMessageId;
    const bindings = { guildId: guild.id, requestId: request.id };
    try {
      const thread = await this.thread(guild, request.threadId);
      if (!thread) return;
      const message = await thread.messages.fetch(messageId).catch(() => null);
      if (!message) return;
      if (thread.archived) await thread.edit({ archived: false }).catch(() => null);
      await message
        .edit(await this.renderInvite(guild.id, request, squad, state, false))
        .catch(logFailure('não foi possível atualizar o convite', bindings));
    } catch (error) {
      log.warn({ err: error, ...bindings }, 'falha ao atualizar o convite');
    }
  }

  private async thread(guild: Guild, threadId: string): Promise<ThreadChannel | null> {
    const channel = await this.ctx.fetchChannel(guild, threadId);
    return channel?.isThread() ? channel : null;
  }

  private async editThread(
    guild: Guild,
    threadId: string | null,
    options: { locked: boolean; archived?: boolean },
  ): Promise<void> {
    if (!threadId) return;
    const thread = await this.thread(guild, threadId);
    await thread
      ?.edit({ ...options, reason: 'Convite para squad respondido' })
      .catch(
        logFailure('não foi possível fechar a thread do convite', { guildId: guild.id, threadId }),
      );
  }
}
