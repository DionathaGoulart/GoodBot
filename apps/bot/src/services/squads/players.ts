import {
  deleteSquadProfile,
  getSquad,
  getSquadGame,
  getSquadProfile,
  listOpenSquadProposals,
  listOpenJoinRequests,
  listSquadMembers,
  listSquads,
  listSquadsForUser,
} from '@goodbot/db';
import { UserFacingError } from '@goodbot/shared';

import { adminActionDm } from './embeds';

import type { SquadContext } from './context';
import type { AdminDmView } from './embeds';
import type { ProfileResult } from './profiles';
import type { RemoveMemberResult } from './squads';
import type { SquadGame, SquadProfile } from '@goodbot/db';
import type {
  DeleteSquadProfileInput,
  EditSquadProfileAnswersInput,
  RemoveSquadMemberInput,
  SetSquadProfileStatusInput,
} from '@goodbot/shared';
import type { Guild } from 'discord.js';

export interface Notified {
  /** A DM com o motivo chegou. `false` = DM fechada, bot bloqueado ou pessoa fora do servidor. */
  notified: boolean;
}

/**
 * O admin cuidando do perfil de outra pessoa pelo painel: pausar, retomar,
 * editar respostas, apagar perfil e tirar de um squad.
 *
 * As mensagens de `ProfileService` falam com o próprio jogador ("Você ainda
 * não tem perfil"), então as checagens daqui vêm antes de delegar, em terceira
 * pessoa. Toda ação segue a mesma ordem: checagens, efeito, auditoria com o
 * motivo e a DM com o motivo. A DM vem por último porque conta um fato
 * consumado: ação recusada não manda DM, e DM que falha não desfaz nada.
 */
export class PlayerAdminService {
  constructor(private readonly ctx: SquadContext) {}

  async setStatus(
    guild: Guild,
    gameId: string,
    userId: string,
    input: SetSquadProfileStatusInput,
  ): Promise<ProfileResult & Notified> {
    await this.ctx.requireConfig(guild.id);
    const game = await this.requireGame(guild.id, gameId);
    if (input.status === 'searching' && !game.enabled) {
      throw new UserFacingError('Este jogo está desligado. Ligue o jogo antes de retomar a busca.', {
        code: 'GAME_DISABLED',
      });
    }
    const profile = await this.requireProfile(guild.id, userId, gameId);
    if (await this.inSquadOfGame(guild.id, userId, gameId)) {
      throw new UserFacingError(
        'Esta pessoa está num squad deste jogo. Só o bot muda esse status: tire a pessoa do squad antes.',
        { code: 'PROFILE_IN_SQUAD' },
      );
    }
    // `ProfileService.setStatus` aceita repetir; aqui cada clique vira uma DM.
    if (profile.status === input.status) {
      throw new UserFacingError(
        input.status === 'paused'
          ? 'O perfil desta pessoa já está pausado.'
          : 'O perfil desta pessoa já está procurando.',
        { code: 'STATUS_UNCHANGED' },
      );
    }
    if (input.status === 'searching' && profile.availability === 0) {
      throw new UserFacingError(
        'Este perfil não tem horários marcados. Só a própria pessoa pode marcar a grade.',
        { code: 'NO_AVAILABILITY' },
      );
    }

    // Fora da fila do jogo: retomar roda o match, que entra na fila sozinho.
    const result = await this.ctx.parts.profiles.setStatus(guild.id, userId, gameId, input.status);
    this.ctx.record({
      guildId: guild.id,
      action: 'squad.profile.status',
      source: 'dashboard',
      actor: input.actorId,
      target: { type: 'member', id: userId },
      reason: input.reason,
      before: { gameId, status: profile.status },
      after: { gameId, status: result.profile.status },
    });
    const notified = await this.notify(guild, userId, {
      kind: input.status === 'paused' ? 'paused' : 'resumed',
      game,
      reason: input.reason,
    });
    return { ...result, notified };
  }

  /** Respostas conferidas contra os campos atuais do jogo. Não roda o match. */
  async editAnswers(
    guild: Guild,
    gameId: string,
    userId: string,
    input: EditSquadProfileAnswersInput,
  ): Promise<{ profile: SquadProfile } & Notified> {
    const { profiles } = this.ctx.parts;
    await this.ctx.requireConfig(guild.id);
    const game = await profiles.requireGame(guild.id, gameId);
    // Sem esta checagem `saveAnswers` criaria um perfil novo para a pessoa.
    const before = await this.requireProfile(guild.id, userId, gameId);

    const profile = await profiles.saveAnswers(guild, userId, gameId, input.answers);
    this.ctx.record({
      guildId: guild.id,
      action: 'squad.profile.answers',
      source: 'dashboard',
      actor: input.actorId,
      target: { type: 'member', id: userId },
      reason: input.reason,
      before: { gameId, answers: before.answers },
      after: { gameId, answers: profile.answers },
    });
    const notified = await this.notify(guild, userId, {
      kind: 'answers',
      game,
      reason: input.reason,
    });
    return { profile, notified };
  }

  /**
   * Na fila do jogo: a passada do matcher lê os perfis `searching` e poderia
   * propor alguém cujo perfil some no meio. A DM sai depois de soltar a fila.
   */
  async deleteProfile(
    guild: Guild,
    gameId: string,
    userId: string,
    input: DeleteSquadProfileInput,
  ): Promise<{ deleted: SquadProfile } & Notified> {
    const { db } = this.ctx;
    await this.ctx.requireConfig(guild.id);
    const game = await this.requireGame(guild.id, gameId);

    const deleted = await this.ctx.parts.matcher.withGameLock(guild.id, gameId, async () => {
      const profile = await this.requireProfile(guild.id, userId, gameId);
      if (profile.status === 'in_squad' || (await this.inSquadOfGame(guild.id, userId, gameId))) {
        throw new UserFacingError(
          'Esta pessoa está num squad deste jogo. Tire do squad antes de apagar o perfil.',
          { code: 'PROFILE_IN_SQUAD' },
        );
      }
      const proposals = await listOpenSquadProposals(db, guild.id);
      const inProposal = proposals.some(
        (proposal) =>
          proposal.gameId === gameId &&
          proposal.userIds.includes(userId) &&
          !proposal.declinedIds.includes(userId),
      );
      if (inProposal) {
        throw new UserFacingError(
          'Esta pessoa está numa proposta aberta deste jogo. Espere a proposta fechar ou expirar.',
          { code: 'PROFILE_IN_PROPOSAL' },
        );
      }
      const live = await listSquads(db, guild.id, { gameId, statuses: ['open', 'full'] });
      const liveIds = new Set(live.map((squad) => squad.id));
      const requests = await listOpenJoinRequests(db, guild.id);
      if (requests.some((request) => request.userId === userId && liveIds.has(request.squadId))) {
        throw new UserFacingError(
          'Esta pessoa tem um pedido de entrada esperando resposta num squad deste jogo.',
          { code: 'PROFILE_HAS_JOIN_REQUEST' },
        );
      }

      const row = await deleteSquadProfile(db, guild.id, userId, gameId);
      if (!row) throw this.profileNotFound();
      return row;
    });

    this.ctx.record({
      guildId: guild.id,
      action: 'squad.profile.delete',
      source: 'dashboard',
      actor: input.actorId,
      target: { type: 'member', id: userId },
      reason: input.reason,
      before: deleted,
    });
    const notified = await this.notify(guild, userId, {
      kind: 'deleted',
      game,
      reason: input.reason,
    });
    return { deleted, notified };
  }

  /**
   * Tira alguém do squad. Funciona com o módulo desligado, como arquivar: é
   * limpeza. A auditoria `squad.member.leave` com o motivo sai do próprio
   * `removeMember`; o canal do squad fica sabendo que foi a staff, sem motivo.
   */
  async removeFromSquad(
    guild: Guild,
    squadId: string,
    userId: string,
    input: RemoveSquadMemberInput,
  ): Promise<RemoveMemberResult & Notified> {
    const { db } = this.ctx;
    const squad = await getSquad(db, guild.id, squadId);
    if (!squad) throw new UserFacingError('Squad não encontrado.', { code: 'SQUAD_NOT_FOUND' });
    if (squad.status === 'archived') {
      throw new UserFacingError('Este squad já foi arquivado.', { code: 'SQUAD_ARCHIVED' });
    }
    const members = await listSquadMembers(db, guild.id, squadId);
    if (!members.some((member) => member.userId === userId)) {
      throw new UserFacingError('Esta pessoa não está neste squad.', { code: 'NOT_A_MEMBER' });
    }
    const game = await getSquadGame(db, guild.id, squad.gameId);

    const result = await this.ctx.parts.squads.removeMember(guild, squadId, userId, input.reason, {
      source: 'dashboard',
      actorId: input.actorId,
      force: true,
      removedBy: input.actorId,
    });
    const notified = await this.notify(guild, userId, {
      kind: 'removed',
      game: { name: game?.name ?? 'o jogo' },
      squad: { name: squad.name },
      profileStatus: result.profileStatus,
      reason: input.reason,
    });
    return { ...result, notified };
  }

  private async notify(
    guild: Guild,
    userId: string,
    view: Omit<AdminDmView, 'guildName' | 'embedColor'>,
  ): Promise<boolean> {
    const message = adminActionDm({
      ...view,
      guildName: guild.name,
      embedColor: await this.ctx.embedColor(guild.id),
    });
    return this.ctx.sendDm(userId, message, { guildId: guild.id, action: view.kind });
  }

  private async requireGame(guildId: string, gameId: string): Promise<SquadGame> {
    const game = await getSquadGame(this.ctx.db, guildId, gameId);
    if (!game) throw new UserFacingError('Jogo não encontrado.', { code: 'GAME_NOT_FOUND' });
    return game;
  }

  private async requireProfile(
    guildId: string,
    userId: string,
    gameId: string,
  ): Promise<SquadProfile> {
    const profile = await getSquadProfile(this.ctx.db, guildId, userId, gameId);
    if (!profile) throw this.profileNotFound();
    return profile;
  }

  private profileNotFound(): UserFacingError {
    return new UserFacingError('Esta pessoa não tem perfil neste jogo.', {
      code: 'PROFILE_NOT_FOUND',
    });
  }

  /** Membro de um squad `open|full` deste jogo. */
  private async inSquadOfGame(guildId: string, userId: string, gameId: string): Promise<boolean> {
    const squads = await listSquadsForUser(this.ctx.db, guildId, userId);
    return squads.some((squad) => squad.gameId === gameId);
  }
}
