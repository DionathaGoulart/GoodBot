import {
  getSquadGame,
  listMembersOfSquads,
  listOpenSquadProposals,
  listPendingJoinRequests,
  listRecentProposalPairs,
  listSquadProfilesByGame,
  listSquads,
} from '@goodbot/db';
import {
  DAY_MS,
  evaluateManualMatch,
  manualMatchPeople,
  unconfirmedWarnings,
  UserFacingError,
} from '@goodbot/shared';

import { manualProposalNote } from './embeds';

import type { SquadContext } from './context';
import type { SearchChannelResult } from './matcher';
import type { SquadGame, SquadProposal } from '@goodbot/db';
import type {
  ManualMatchEvaluation,
  ManualMatchInput,
  ManualMatchIssue,
  ProposeSquadManuallyInput,
  SquadManualCheckInput,
  SquadsConfig,
} from '@goodbot/shared';
import type { Guild } from 'discord.js';

/** O que a escrita manual devolve: recusada pela revisão ou feita. */
export type ManualOutcome<T> =
  | { outcome: 'blocked'; check: ManualMatchEvaluation }
  | { outcome: 'unconfirmed'; check: ManualMatchEvaluation; pending: ManualMatchIssue[] }
  | ({ outcome: 'done'; check: ManualMatchEvaluation } & T);

function searchChannelError(result: Exclude<SearchChannelResult, { ok: true }>): UserFacingError {
  switch (result.reason) {
    case 'no-channel':
      return new UserFacingError('Escolha o canal de busca antes de propor.', {
        code: 'SQUADS_NO_SEARCH_CHANNEL',
      });
    case 'not-text':
      return new UserFacingError('O canal de busca configurado não é um canal de texto.', {
        code: 'SQUADS_NO_SEARCH_CHANNEL',
      });
    case 'missing-permissions':
      return new UserFacingError('Não tenho permissão para abrir thread privada no canal de busca.', {
        code: 'MISSING_PERMISSIONS',
      });
  }
}

/**
 * Match manual: o admin escolhe a turma no painel e o bot abre a mesma
 * proposta do match automático (thread privada, Aceito e Passo). Ninguém entra
 * em squad sem clicar; o que muda é só quem foi chamado.
 *
 * A revisão roda de novo dentro da fila do jogo antes de escrever, com dados
 * frescos do banco e a presença de cada um no servidor. É isso que torna o
 * duplo clique inofensivo: a segunda chamada vê a proposta que a primeira
 * abriu e cai em `IN_OPEN_PROPOSAL`.
 */
export class ManualMatchService {
  constructor(private readonly ctx: SquadContext) {}

  /** Revisão sem efeito: duplas, janela, bloqueios e avisos. */
  async check(
    guild: Guild,
    gameId: string,
    input: SquadManualCheckInput,
  ): Promise<ManualMatchEvaluation> {
    const config = await this.ctx.requireConfig(guild.id);
    const game = await this.requireEnabledGame(guild.id, gameId);
    return evaluateManualMatch(await this.loadContext(guild, game, config, input.userIds));
  }

  async propose(
    guild: Guild,
    gameId: string,
    input: ProposeSquadManuallyInput,
  ): Promise<ManualOutcome<{ proposal: SquadProposal }>> {
    const config = await this.ctx.requireConfig(guild.id);
    const game = await this.requireEnabledGame(guild.id, gameId);
    const { matcher } = this.ctx.parts;

    return matcher.withGameLock(guild.id, game.id, async () => {
      const check = evaluateManualMatch(await this.loadContext(guild, game, config, input.userIds));
      if (check.blocks.length > 0) return { outcome: 'blocked', check };
      const pending = unconfirmedWarnings(check, input.confirmedWarnings);
      if (pending.length > 0) return { outcome: 'unconfirmed', check, pending };

      const search = await matcher.searchChannel(guild, config);
      if (!search.ok) throw searchChannelError(search);
      // Sem bloqueio há pelo menos duas pessoas com perfil e uma célula comum.
      if (!check.slot) throw new Error('revisão sem bloqueio e sem janela');

      const proposal = await matcher.openProposal(
        guild,
        search.channel,
        game,
        config,
        { userIds: check.userIds, mask: check.commonMask, slot: check.slot },
        { note: manualProposalNote(input.actorId) },
      );
      if (!proposal) {
        throw new UserFacingError(
          'Não consegui colocar pelo menos duas pessoas na thread. Confira se elas ainda estão no servidor.',
          { code: 'PROPOSAL_NOT_OPENED' },
        );
      }

      this.ctx.record({
        guildId: guild.id,
        action: 'squad.proposal.manual',
        source: 'dashboard',
        actor: input.actorId,
        target: { type: 'squad_proposal', id: proposal.id },
        after: {
          gameId: game.id,
          userIds: proposal.userIds,
          slot: check.slot,
          confirmedWarnings: check.warnings.map((warning) => warning.key),
        },
      });
      return { outcome: 'done', check, proposal };
    });
  }

  private async requireEnabledGame(guildId: string, gameId: string): Promise<SquadGame> {
    const game = await getSquadGame(this.ctx.db, guildId, gameId);
    if (!game) throw new UserFacingError('Jogo não encontrado.', { code: 'GAME_NOT_FOUND' });
    if (!game.enabled) {
      throw new UserFacingError('Este jogo está desligado. Ligue o jogo antes de propor.', {
        code: 'GAME_DISABLED',
      });
    }
    return game;
  }

  /** Uma leitura por tipo, nada por pessoa no banco; a presença vem do Discord. */
  private async loadContext(
    guild: Guild,
    game: SquadGame,
    config: SquadsConfig,
    userIds: readonly string[],
  ): Promise<ManualMatchInput> {
    const { db } = this.ctx;
    const since = new Date(this.ctx.now() - config.reproposeCooldownDays * DAY_MS);
    const [profiles, openProposals, liveSquads, pendingRequests, cooldownPairs] = await Promise.all([
      listSquadProfilesByGame(db, guild.id, game.id, { userIds }),
      listOpenSquadProposals(db, guild.id),
      listSquads(db, guild.id, { statuses: ['open', 'full'] }),
      listPendingJoinRequests(db, guild.id),
      listRecentProposalPairs(db, guild.id, game.id, since),
    ]);

    const members = await listMembersOfSquads(
      db,
      guild.id,
      liveSquads.map((squad) => squad.id),
    );
    const memberIds = new Map<string, string[]>();
    for (const member of members) {
      memberIds.set(member.squadId, [...(memberIds.get(member.squadId) ?? []), member.userId]);
    }

    const membership = new Map<string, boolean>();
    const presence = await Promise.all(
      profiles.map(async (profile) => [profile.userId, await this.ctx.isGuildMember(guild, profile.userId)] as const),
    );
    for (const [userId, present] of presence) {
      if (present !== null) membership.set(userId, present);
    }

    return {
      game: { partySize: game.partySize, fields: game.fields },
      maxSquadsPerUser: config.maxSquadsPerUser,
      userIds,
      people: manualMatchPeople({
        gameId: game.id,
        profiles,
        openProposals,
        liveSquads: liveSquads.map((squad) => ({
          id: squad.id,
          gameId: squad.gameId,
          memberIds: memberIds.get(squad.id) ?? [],
        })),
        pendingRequests,
        membership,
      }),
      cooldownPairs: new Set(cooldownPairs),
    };
  }
}
