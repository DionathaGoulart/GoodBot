import {
  countSquadsForUser,
  createSquadJoinRequest,
  decideSquadJoinRequest,
  declineSquadJoinRequestBy,
  expireSquadJoinRequestsBefore,
  getSquad,
  getSquadGame,
  getSquadJoinRequest,
  getSquadProfile,
  listPendingJoinRequests,
  listSquadMembers,
  setSquadJoinRequestMessage,
} from '@goodbot/db';
import { HOUR_MS, isUserFacingError, UserFacingError } from '@goodbot/shared';

import { log, logFailure } from './context';
import { joinRequestMessage } from './embeds';

import type { SquadContext } from './context';
import type { JoinRequestState } from './embeds';
import type { Squad, SquadJoinRequest, SquadMember } from '@goodbot/db';
import type { SquadRequestStatus } from '@goodbot/shared';
import type { BaseMessageOptions, Guild } from 'discord.js';

export type JoinRequestSource = 'matcher' | 'manual';

export type JoinRequestDecision =
  | { outcome: 'accepted'; squad: Squad }
  /** Todos os membros atuais recusaram. */
  | { outcome: 'declined' }
  /** Uma recusa registrada; o pedido segue pendente para os outros. */
  | { outcome: 'recorded' }
  | { outcome: 'already'; status: SquadRequestStatus };

/**
 * Pedido para entrar num squad existente. Vai para o canal do squad, basta um
 * membro aceitar e é silencioso para o candidato até ser aceito: sem DM, sem
 * thread, nada que ele veja se o squad recusar.
 */
export class JoinRequestService {
  constructor(private readonly ctx: SquadContext) {}

  /** `null` quando já havia pedido pendente ou o canal do squad não aceitou a mensagem. */
  async create(
    guild: Guild,
    squad: Squad,
    candidateUserId: string,
    source: JoinRequestSource,
  ): Promise<SquadJoinRequest | null> {
    const { db } = this.ctx;
    const request = await createSquadJoinRequest(db, {
      guildId: guild.id,
      squadId: squad.id,
      userId: candidateUserId,
    });
    if (!request) return null;

    try {
      const channel = await this.ctx.textChannel(guild, squad);
      if (!channel) throw new Error('squad sem canal de texto');
      const message = await channel.send(await this.render(guild.id, request, squad, 'pending'));
      const saved = await setSquadJoinRequestMessage(db, guild.id, request.id, message.id);
      log.info(
        { guildId: guild.id, squadId: squad.id, requestId: request.id, source },
        'pedido de entrada criado',
      );
      return saved ?? { ...request, messageId: message.id };
    } catch (error) {
      // Pedido sem mensagem não tem botão: encerra para não travar a vaga.
      log.warn(
        { err: error, guildId: guild.id, squadId: squad.id },
        'pedido de entrada sem mensagem',
      );
      await decideSquadJoinRequest(db, guild.id, request.id, {
        status: 'expired',
        decidedBy: null,
        at: this.ctx.date(),
      }).catch(() => null);
      return null;
    }
  }

  async accept(
    guild: Guild,
    requestId: string,
    memberUserId: string,
  ): Promise<JoinRequestDecision> {
    const { db } = this.ctx;
    const config = await this.ctx.requireConfig(guild.id);
    const { request, squad, members } = await this.loadForMember(guild.id, requestId, memberUserId);
    if (request.status !== 'pending') return { outcome: 'already', status: request.status };

    const game = await getSquadGame(db, guild.id, squad.gameId);
    if (!game || members.length >= game.squadSize) {
      await this.close(guild, request, squad, 'expired');
      throw new UserFacingError('O squad já encheu, então este pedido foi encerrado.', {
        code: 'SQUAD_FULL',
      });
    }
    if ((await countSquadsForUser(db, guild.id, request.userId)) >= config.maxSquadsPerUser) {
      await this.close(guild, request, squad, 'expired');
      throw new UserFacingError(
        'Esta pessoa já entrou em outro squad, então o pedido foi encerrado.',
        {
          code: 'CANDIDATE_UNAVAILABLE',
        },
      );
    }

    const decided = await decideSquadJoinRequest(db, guild.id, request.id, {
      status: 'accepted',
      decidedBy: memberUserId,
      at: this.ctx.date(),
    });
    if (!decided) {
      const fresh = await getSquadJoinRequest(db, guild.id, request.id);
      return { outcome: 'already', status: fresh?.status ?? 'expired' };
    }

    try {
      const { squad: joined } = await this.ctx.parts.squads.addMember(
        guild,
        squad.id,
        request.userId,
        {
          source: 'event',
          ping: true,
          actorId: memberUserId,
        },
      );
      await this.rerender(guild, decided, joined, 'accepted');
      return { outcome: 'accepted', squad: joined };
    } catch (error) {
      if (isUserFacingError(error)) await this.rerender(guild, decided, squad, 'expired');
      throw error;
    }
  }

  async decline(
    guild: Guild,
    requestId: string,
    memberUserId: string,
  ): Promise<JoinRequestDecision> {
    const { db } = this.ctx;
    await this.ctx.requireConfig(guild.id);
    const { request, squad, members } = await this.loadForMember(guild.id, requestId, memberUserId);
    if (request.status !== 'pending') return { outcome: 'already', status: request.status };

    const updated =
      (await declineSquadJoinRequestBy(db, guild.id, request.id, memberUserId)) ??
      (await getSquadJoinRequest(db, guild.id, request.id));
    if (updated?.status !== 'pending') {
      return { outcome: 'already', status: updated?.status ?? 'expired' };
    }

    const everyoneDeclined = members.every((member) => updated.declinedIds.includes(member.userId));
    if (!everyoneDeclined) {
      await this.rerender(guild, updated, squad, 'pending');
      return { outcome: 'recorded' };
    }

    const decided = await decideSquadJoinRequest(db, guild.id, request.id, {
      status: 'declined',
      decidedBy: memberUserId,
      at: this.ctx.date(),
    });
    if (!decided) {
      const fresh = await getSquadJoinRequest(db, guild.id, request.id);
      return { outcome: 'already', status: fresh?.status ?? 'expired' };
    }
    await this.rerender(guild, decided, squad, 'declined');
    return { outcome: 'declined' };
  }

  /** Pendentes mais velhos que `proposalTtlHours` expiram. Devolve quantos. */
  async expireRequests(guildId: string): Promise<number> {
    const { db } = this.ctx;
    const config = await this.ctx.config.get(guildId, 'squads');
    const before = new Date(this.ctx.now() - config.proposalTtlHours * HOUR_MS);
    const expired = await expireSquadJoinRequestsBefore(db, guildId, before);
    const guild = this.ctx.client.guilds.cache.get(guildId);
    if (guild) {
      for (const request of expired) {
        const squad = await getSquad(db, guildId, request.squadId);
        if (squad) await this.rerender(guild, request, squad, 'expired');
      }
    }
    return expired.length;
  }

  /** Squad arquivado: os pedidos pendentes dele morrem junto. */
  async expireForSquad(guild: Guild, squad: Squad): Promise<void> {
    try {
      const pending = await listPendingJoinRequests(this.ctx.db, guild.id, squad.id);
      for (const request of pending) await this.close(guild, request, squad, 'expired');
    } catch (error) {
      log.warn(
        { err: error, guildId: guild.id, squadId: squad.id },
        'falha ao encerrar pedidos do squad',
      );
    }
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
      throw new UserFacingError('Só quem é do squad pode decidir este pedido.', {
        code: 'NOT_A_MEMBER',
      });
    }
    return { request, squad, members };
  }

  private async close(
    guild: Guild,
    request: SquadJoinRequest,
    squad: Squad,
    status: 'declined' | 'expired',
  ): Promise<void> {
    const decided = await decideSquadJoinRequest(this.ctx.db, guild.id, request.id, {
      status,
      decidedBy: null,
      at: this.ctx.date(),
    });
    if (decided) await this.rerender(guild, decided, squad, status);
  }

  private async render(
    guildId: string,
    request: SquadJoinRequest,
    squad: Squad,
    state: JoinRequestState,
  ): Promise<BaseMessageOptions> {
    const { db } = this.ctx;
    const [config, embedColor, game, profile, members] = await Promise.all([
      this.ctx.config.get(guildId, 'squads'),
      this.ctx.embedColor(guildId),
      getSquadGame(db, guildId, squad.gameId),
      getSquadProfile(db, guildId, request.userId, squad.gameId),
      listSquadMembers(db, guildId, squad.id),
    ]);
    return joinRequestMessage({
      request,
      squad,
      game: { fields: game?.fields ?? [] },
      answers: profile?.answers ?? {},
      blocks: config.blocks,
      memberCount: members.length,
      state,
      embedColor,
    });
  }

  /** Reedita a mensagem do pedido; nunca lança. */
  private async rerender(
    guild: Guild,
    request: SquadJoinRequest,
    squad: Squad,
    state: JoinRequestState,
  ): Promise<void> {
    if (!request.messageId) return;
    const messageId = request.messageId;
    const bindings = { guildId: guild.id, requestId: request.id };
    try {
      const channel = await this.ctx.textChannel(guild, squad);
      const message = await channel?.messages.fetch(messageId).catch(() => null);
      if (!message) return;
      await message
        .edit(await this.render(guild.id, request, squad, state))
        .catch(logFailure('não foi possível atualizar o pedido de entrada', bindings));
    } catch (error) {
      log.warn({ err: error, ...bindings }, 'falha ao atualizar o pedido de entrada');
    }
  }
}
