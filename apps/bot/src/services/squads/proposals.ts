import {
  acceptSquadProposal,
  claimProposalSquad,
  closeSquadProposal,
  createSquad,
  declineSquadProposal,
  getSquad,
  getSquadGame,
  getSquadProfile,
  getSquadProposal,
  listExpiredSquadProposals,
  listOpenSquadProposals,
  listSquads,
} from '@goodbot/db';
import { bestSlot, UserFacingError } from '@goodbot/shared';
import { ChannelType } from 'discord.js';
import { TransactionRollbackError } from 'drizzle-orm';

import { log, logFailure } from './context';
import { proposalMessage } from './embeds';
import { defaultSquadName } from './slots';

import type { SquadContext } from './context';
import type { ProposalState } from './embeds';
import type { Squad, SquadGame, SquadProposal } from '@goodbot/db';
import type { SquadCell, SquadsConfig } from '@goodbot/shared';
import type { Guild } from 'discord.js';

export type ProposalAcceptResult =
  { outcome: 'created' | 'joined'; squad: Squad } | { outcome: 'already'; squad: Squad | null };

export interface ProposalDeclineResult {
  outcome: 'declined' | 'already';
}

/**
 * Janela de reserva quando ninguém da turma tem célula marcada (as grades
 * foram zeradas entre o match e o aceite): sábado à noite, o horário mais
 * comum, que o squad pode combinar de mudar.
 */
const FALLBACK_SLOT: SquadCell = { day: 6, block: 2 };

/** Aceite sem líder: o primeiro cria o squad, os seguintes ocupam vaga. */
export class ProposalService {
  constructor(private readonly ctx: SquadContext) {}

  async accept(guild: Guild, proposalId: string, userId: string): Promise<ProposalAcceptResult> {
    const { db } = this.ctx;
    const config = await this.ctx.requireConfig(guild.id);
    const proposal = await this.loadForDecision(guild, proposalId, userId);
    if (proposal.acceptedIds.includes(userId)) return this.already(guild.id, proposal);

    const game = await getSquadGame(db, guild.id, proposal.gameId);
    if (!game?.enabled) {
      throw new UserFacingError('Este jogo não está mais disponível para squads.', {
        code: 'GAME_NOT_FOUND',
      });
    }

    // Tudo que pode recusar vem antes do aceite gravado: um aceite que não
    // vira vaga só confundiria a contagem da proposta.
    await this.ctx.parts.squads.assertCanJoinAnother(guild.id, userId, config);
    if (proposal.squadId)
      await this.ctx.parts.squads.assertJoinable(guild.id, proposal.squadId, game);
    else await this.assertCategory(guild, config);

    const accepted = await acceptSquadProposal(db, guild.id, proposal.id, userId);
    if (!accepted) {
      const fresh = await getSquadProposal(db, guild.id, proposal.id);
      if (fresh?.acceptedIds.includes(userId)) return this.already(guild.id, fresh);
      throw new UserFacingError('Esta proposta já foi encerrada.', { code: 'PROPOSAL_CLOSED' });
    }

    try {
      if (accepted.squadId) return await this.join(guild, accepted.squadId, userId);
      return await this.createOrJoin(guild, config, game, accepted, userId);
    } finally {
      await this.refresh(guild, proposal.id);
    }
  }

  async decline(guild: Guild, proposalId: string, userId: string): Promise<ProposalDeclineResult> {
    await this.ctx.requireConfig(guild.id);
    const proposal = await this.loadForDecision(guild, proposalId, userId);
    if (proposal.acceptedIds.includes(userId)) {
      throw new UserFacingError('Você já aceitou. Para sair do squad use /squad sair.', {
        code: 'ALREADY_ACCEPTED',
      });
    }
    const declined = await declineSquadProposal(this.ctx.db, guild.id, proposal.id, userId);
    if (!declined) return { outcome: 'already' };
    await this.refresh(guild, proposal.id);
    return { outcome: 'declined' };
  }

  /** Fecha por prazo: mensagem sem botões e thread trancada. `false` se já estava fechada. */
  async expire(guild: Guild, proposal: SquadProposal): Promise<boolean> {
    const closed = await closeSquadProposal(this.ctx.db, guild.id, proposal.id, this.ctx.date());
    if (!closed) return false;
    try {
      const squad = closed.squadId ? await getSquad(this.ctx.db, guild.id, closed.squadId) : null;
      await this.render(guild, closed, squad, 'expired');
      await this.archiveThread(guild, closed.threadId);
    } catch (error) {
      log.warn(
        { err: error, guildId: guild.id, proposalId: closed.id },
        'falha ao expirar a proposta',
      );
    }
    return true;
  }

  /** Expira as propostas abertas com prazo vencido. Devolve quantas fechou. */
  async expireDue(guildId: string): Promise<number> {
    const guild = this.ctx.client.guilds.cache.get(guildId);
    if (!guild) return 0;
    const due = await listExpiredSquadProposals(this.ctx.db, guildId, this.ctx.date());
    let expired = 0;
    for (const proposal of due) {
      if (await this.expire(guild, proposal)) expired++;
    }
    return expired;
  }

  /** Fecha as propostas abertas de um squad que acabou de ser arquivado. */
  async closeForSquad(guild: Guild, squadId: string): Promise<void> {
    const open = await listOpenSquadProposals(this.ctx.db, guild.id);
    for (const proposal of open) {
      if (proposal.squadId === squadId) await this.refresh(guild, proposal.id);
    }
  }

  /**
   * Relê a proposta, fecha quando todo mundo decidiu ou o squad encheu (ou foi
   * arquivado) e reedita a mensagem. Nunca lança: roda depois de uma decisão
   * que já foi gravada.
   */
  async refresh(guild: Guild, proposalId: string): Promise<SquadProposal | null> {
    const { db } = this.ctx;
    try {
      const proposal = await getSquadProposal(db, guild.id, proposalId);
      if (!proposal) return null;
      const squad = proposal.squadId ? await getSquad(db, guild.id, proposal.squadId) : null;

      const everyoneDecided = proposal.userIds.every(
        (id) => proposal.acceptedIds.includes(id) || proposal.declinedIds.includes(id),
      );
      const done = everyoneDecided || squad?.status === 'full' || squad?.status === 'archived';

      let current = proposal;
      if (!proposal.closedAt && done) {
        current =
          (await closeSquadProposal(db, guild.id, proposal.id, this.ctx.date())) ?? proposal;
      }
      const closed = current.closedAt !== null || done;
      await this.render(guild, current, squad, closed ? 'closed' : 'open');
      if (closed) await this.archiveThread(guild, current.threadId);
      return current;
    } catch (error) {
      log.error({ err: error, guildId: guild.id, proposalId }, 'falha ao atualizar a proposta');
      return null;
    }
  }

  private async loadForDecision(
    guild: Guild,
    proposalId: string,
    userId: string,
  ): Promise<SquadProposal> {
    const proposal = await getSquadProposal(this.ctx.db, guild.id, proposalId);
    if (!proposal) {
      throw new UserFacingError('Esta proposta não existe mais.', { code: 'PROPOSAL_NOT_FOUND' });
    }
    if (proposal.closedAt) {
      throw new UserFacingError('Esta proposta já foi encerrada.', { code: 'PROPOSAL_CLOSED' });
    }
    if (proposal.expiresAt.getTime() <= this.ctx.now()) {
      await this.expire(guild, proposal);
      throw new UserFacingError('Esta proposta expirou.', { code: 'PROPOSAL_EXPIRED' });
    }
    if (!proposal.userIds.includes(userId)) {
      throw new UserFacingError('Esta proposta não é para você.', { code: 'NOT_IN_PROPOSAL' });
    }
    return proposal;
  }

  private async already(guildId: string, proposal: SquadProposal): Promise<ProposalAcceptResult> {
    const squad = proposal.squadId ? await getSquad(this.ctx.db, guildId, proposal.squadId) : null;
    return { outcome: 'already', squad };
  }

  /** Sem categoria válida não há onde criar o canal: melhor recusar antes de gravar nada. */
  private async assertCategory(guild: Guild, config: SquadsConfig): Promise<void> {
    const category = config.categoryId
      ? await this.ctx.fetchChannel(guild, config.categoryId)
      : null;
    if (category?.type !== ChannelType.GuildCategory) {
      throw new UserFacingError(
        'Os squads ainda não têm uma categoria para os canais. Peça a um admin para escolher a categoria no painel.',
        { code: 'SQUADS_NO_CATEGORY' },
      );
    }
  }

  private async join(guild: Guild, squadId: string, userId: string): Promise<ProposalAcceptResult> {
    const { squad } = await this.ctx.parts.squads.addMember(guild, squadId, userId, {
      source: 'event',
      ping: true,
    });
    return { outcome: 'joined', squad };
  }

  /**
   * O primeiro aceite. A linha do squad e a reivindicação da proposta vão na
   * mesma transação: dois "Aceito" no mesmo instante esperam um pelo outro no
   * `UPDATE` da proposta, e quem perde faz rollback (o squad dele some junto)
   * e entra no squad de quem ganhou. Só o vencedor cria canal no Discord.
   */
  private async createOrJoin(
    guild: Guild,
    config: SquadsConfig,
    game: SquadGame,
    proposal: SquadProposal,
    userId: string,
  ): Promise<ProposalAcceptResult> {
    const { db } = this.ctx;
    const slot = (await this.slotFor(guild.id, proposal)) ?? FALLBACK_SLOT;
    const existing = await listSquads(db, guild.id, { gameId: game.id });
    const name = defaultSquadName(game.name, existing.length + 1);

    let squad: Squad | null = null;
    try {
      squad = await db.transaction(async (tx) => {
        const row = await createSquad(tx, {
          guildId: guild.id,
          gameId: game.id,
          name,
          day: slot.day,
          block: slot.block,
          status: 'open',
        });
        const claimed = await claimProposalSquad(tx, guild.id, proposal.id, row.id);
        if (!claimed) tx.rollback();
        return row;
      });
    } catch (error) {
      if (!(error instanceof TransactionRollbackError)) throw error;
    }

    if (!squad) {
      const fresh = await getSquadProposal(db, guild.id, proposal.id);
      if (!fresh?.squadId) {
        throw new UserFacingError('Esta proposta já foi encerrada.', { code: 'PROPOSAL_CLOSED' });
      }
      log.info(
        { guildId: guild.id, proposalId: proposal.id, userId },
        'primeiro aceite disputado; entrando no squad de quem chegou antes',
      );
      return this.join(guild, fresh.squadId, userId);
    }

    const home = await this.ctx.parts.squads.setUpHome(guild, config, game, squad, userId);
    return { outcome: 'created', squad: home };
  }

  /** A célula com mais gente entre quem aceitou ou ainda não passou, relida dos perfis. */
  private async slotFor(guildId: string, proposal: SquadProposal): Promise<SquadCell | null> {
    const ids = proposal.userIds.filter((id) => !proposal.declinedIds.includes(id));
    const profiles = await Promise.all(
      ids.map((id) => getSquadProfile(this.ctx.db, guildId, id, proposal.gameId)),
    );
    const slot = bestSlot(profiles.flatMap((profile) => (profile ? [profile.availability] : [])));
    return slot ? { day: slot.day, block: slot.block } : null;
  }

  private async render(
    guild: Guild,
    proposal: SquadProposal,
    squad: Squad | null,
    state: ProposalState,
  ): Promise<void> {
    if (!proposal.messageId) return;
    const thread = await this.ctx.fetchChannel(guild, proposal.threadId);
    if (!thread?.isThread()) return;
    const message = await thread.messages.fetch(proposal.messageId).catch(() => null);
    if (!message) return;
    // Mensagem em thread arquivada não aceita edição.
    if (thread.archived) await thread.edit({ archived: false }).catch(() => null);

    const [config, embedColor, game] = await Promise.all([
      this.ctx.config.get(guild.id, 'squads'),
      this.ctx.embedColor(guild.id),
      getSquadGame(this.ctx.db, guild.id, proposal.gameId),
    ]);
    const slot = squad
      ? { day: squad.day, block: squad.block }
      : await this.slotFor(guild.id, proposal);
    await message.edit(
      proposalMessage({
        proposal,
        game: { name: game?.name ?? 'o jogo' },
        slot,
        blocks: config.blocks,
        squad,
        state,
        embedColor,
      }),
    );
  }

  private async archiveThread(guild: Guild, threadId: string): Promise<void> {
    const thread = await this.ctx.fetchChannel(guild, threadId);
    if (!thread?.isThread()) return;
    await thread
      .edit({ locked: true, archived: true, reason: 'Proposta de squad encerrada' })
      .catch(
        logFailure('não foi possível arquivar a thread da proposta', {
          guildId: guild.id,
          threadId,
        }),
      );
  }
}
