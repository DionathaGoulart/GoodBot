import {
  closeSquadProposal,
  countSquadsForUser,
  createSquadProposal,
  getSquadGame,
  getSquadProfile,
  listOpenSquadProposals,
  listOpenSquadsByGame,
  listPendingJoinRequests,
  listRecentJoinRequestKeys,
  listRecentProposalPairs,
  listSearchingProfiles,
  listSquadMembers,
  listSquads,
  markProfilesMatched,
  setSquadProposalMessage,
} from '@goodbot/db';
import {
  cellBit,
  DAY_MS,
  HOUR_MS,
  joinRequestKey,
  MIN_SQUAD_SIZE,
  pairKey,
  proposeGroups,
  scoreProfiles,
} from '@goodbot/shared';
import { ChannelType, PermissionFlagsBits, ThreadAutoArchiveDuration } from 'discord.js';

import { log, logFailure } from './context';
import { proposalMessage } from './embeds';
import { renderProposalThreadName } from './slots';

import type { SquadContext } from './context';
import type { SquadGame, SquadProfile, SquadProposal } from '@goodbot/db';
import type {
  RunSquadMatchResult,
  SquadCell,
  SquadGroupProposal,
  SquadMatchField,
  SquadMatchProfile,
  SquadsConfig,
} from '@goodbot/shared';
import type { BaseMessageOptions, Guild, TextChannel } from 'discord.js';

export type MatchResult = RunSquadMatchResult;

/** O canal de busca pronto para receber thread privada, ou o motivo de não estar. */
export type SearchChannelResult =
  | { ok: true; channel: TextChannel }
  | { ok: false; reason: 'no-channel' | 'not-text' | 'missing-permissions'; missing: string[] };

export interface OpenProposalOptions {
  /** Mensagem a mais na thread, enviada depois que a proposta está pronta. */
  note?: BaseMessageOptions;
}

/**
 * O que o bot precisa no canal de busca para abrir a thread da proposta. O
 * PRD §10 ainda não pede `CreatePrivateThreads` no convite: sem ela o match
 * pula a guild com um aviso no log, em vez de estourar a cada perfil salvo.
 */
export const MATCHER_REQUIRED_BITS =
  PermissionFlagsBits.CreatePrivateThreads |
  PermissionFlagsBits.SendMessagesInThreads |
  PermissionFlagsBits.ManageThreads;

const noMatch = (): MatchResult => ({ proposals: 0, joinRequests: 0 });

export function toMatchProfile(profile: SquadProfile): SquadMatchProfile {
  return { userId: profile.userId, availability: profile.availability, answers: profile.answers };
}

export interface VacancyCandidate {
  userId: string;
  score: number;
}

/**
 * Quem cabe na vaga de um squad: tem a janela dele marcada, não bate de frente
 * num campo `hard` com nenhum membro que tenha perfil e não está em cooldown
 * com nenhum membro. Melhor nota primeiro; empate vai para o menor id.
 */
export function rankVacancyCandidates(input: {
  slot: SquadCell;
  fields: readonly SquadMatchField[];
  memberIds: readonly string[];
  memberProfiles: readonly SquadMatchProfile[];
  candidates: readonly SquadMatchProfile[];
  blockedPairs: ReadonlySet<string>;
}): VacancyCandidate[] {
  const bit = 1 << cellBit(input.slot.day, input.slot.block);
  const ranked: VacancyCandidate[] = [];
  for (const candidate of input.candidates) {
    if ((candidate.availability & bit) === 0) continue;
    const blocked = input.memberIds.some(
      (id) => id === candidate.userId || input.blockedPairs.has(pairKey(candidate.userId, id)),
    );
    if (blocked) continue;

    let score = 0;
    let compatible = true;
    for (const member of input.memberProfiles) {
      const pair = scoreProfiles(input.fields, candidate, member);
      if (!pair.hardOk) {
        compatible = false;
        break;
      }
      score += pair.score;
    }
    if (compatible) ranked.push({ userId: candidate.userId, score });
  }
  return ranked.sort(
    (a, b) => b.score - a.score || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  );
}

/** Cruza perfis `searching`: primeiro preenche vagas abertas, depois propõe grupos novos. */
export class MatcherService {
  /** Uma passada por guild e jogo; quem chega no meio espera a que está rodando. */
  private readonly running = new Map<string, Promise<MatchResult>>();
  /** A última tarefa na fila de cada guild e jogo (ver `withGameLock`). */
  private readonly tails = new Map<string, Promise<unknown>>();

  constructor(private readonly ctx: SquadContext) {}

  runFor(guildId: string, gameId: string): Promise<MatchResult> {
    const key = `${guildId}:${gameId}`;
    const current = this.running.get(key);
    if (current) return current;
    const run = this.withGameLock(guildId, gameId, () => this.run(guildId, gameId)).finally(() => {
      this.running.delete(key);
    });
    this.running.set(key, run);
    return run;
  }

  /**
   * Roda `task` depois de tudo que já segura esta guild e jogo. Passada do
   * matcher, match manual e apagar perfil dividem a fila: sem ela, a passada
   * das 12 h e um clique no painel podiam propor as mesmas duas pessoas.
   * Tarefa que falha não trava quem vem depois.
   *
   * `task` nunca pode esperar `runFor` do mesmo jogo, senão espera a si mesma.
   * A fila é da memória desta instância: o bot roda num processo só.
   */
  withGameLock<T>(guildId: string, gameId: string, task: () => Promise<T>): Promise<T> {
    const key = `${guildId}:${gameId}`;
    const previous = this.tails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.tails.set(key, current);
    const release = () => {
      if (this.tails.get(key) === current) this.tails.delete(key);
    };
    current.then(release, release);
    return current;
  }

  /**
   * O canal de busca, se o bot consegue abrir thread privada nele. A passada
   * do matcher pula com um log quando não dá (é o que o job quer); o match
   * manual transforma o motivo num erro para o admin.
   */
  async searchChannel(
    guild: Guild,
    config: Pick<SquadsConfig, 'searchChannelId'>,
  ): Promise<SearchChannelResult> {
    if (!config.searchChannelId) return { ok: false, reason: 'no-channel', missing: [] };
    const found = await this.ctx.fetchChannel(guild, config.searchChannelId);
    if (found?.type !== ChannelType.GuildText) return { ok: false, reason: 'not-text', missing: [] };
    const channel = found as TextChannel;

    const me = guild.members.me;
    const permissions = me ? channel.permissionsFor(me) : null;
    if (!permissions?.has(MATCHER_REQUIRED_BITS)) {
      return {
        ok: false,
        reason: 'missing-permissions',
        missing: permissions?.missing(MATCHER_REQUIRED_BITS) ?? [],
      };
    }
    return { ok: true, channel };
  }

  private async run(guildId: string, gameId: string): Promise<MatchResult> {
    const { db, client } = this.ctx;
    const config = await this.ctx.config.get(guildId, 'squads');
    if (!config.enabled) return this.skip(guildId, gameId, 'módulo desligado');

    const game = await getSquadGame(db, guildId, gameId);
    if (!game?.enabled) return this.skip(guildId, gameId, 'jogo desligado ou inexistente');
    if (!config.searchChannelId) return this.skip(guildId, gameId, 'sem canal de busca');

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return this.skip(guildId, gameId, 'guild fora do cache');
    const search = await this.searchChannel(guild, config);
    if (!search.ok) {
      if (search.reason !== 'missing-permissions') {
        return this.skip(guildId, gameId, 'canal de busca não é um canal de texto');
      }
      log.warn(
        { guildId, gameId, channelId: config.searchChannelId, missing: search.missing },
        'match de squads pulado: faltam permissões para abrir thread privada no canal de busca',
      );
      return noMatch();
    }
    const { channel } = search;

    const pool = await this.candidates(guildId, game, config);
    if (pool.size === 0) return noMatch();

    const since = new Date(this.ctx.now() - config.reproposeCooldownDays * DAY_MS);
    const blockedPairs = new Set(await listRecentProposalPairs(db, guildId, gameId, since));
    // Pedido recusado (ou expirado) no mesmo squad dentro do cooldown: o
    // candidato não é oferecido de novo a cada passada.
    const recentRequests = new Set(await listRecentJoinRequestKeys(db, guildId, since));

    const joinRequests = await this.fillVacancies(guild, game, pool, blockedPairs, recentRequests);
    const groups = proposeGroups(
      { squadSize: game.squadSize, fields: game.fields },
      [...pool.values()].map(toMatchProfile),
      { blockedPairs },
    );

    let proposals = 0;
    for (const group of groups) {
      try {
        if (await this.openProposal(guild, channel, game, config, group)) proposals++;
      } catch (error) {
        log.error(
          { err: error, guildId, gameId, userIds: group.userIds },
          'falha ao abrir proposta de squad',
        );
      }
    }
    if (proposals > 0 || joinRequests > 0) {
      log.info({ guildId, gameId, proposals, joinRequests }, 'match de squads concluído');
    }
    return { proposals, joinRequests };
  }

  private skip(guildId: string, gameId: string, reason: string): MatchResult {
    log.info({ guildId, gameId, reason }, 'match de squads pulado');
    return noMatch();
  }

  /**
   * Perfis `searching` que podem receber algo agora: fora de proposta aberta
   * deste jogo (a menos que tenham passado), sem pedido pendente num squad
   * deste jogo e abaixo do teto de squads por pessoa.
   */
  private async candidates(
    guildId: string,
    game: SquadGame,
    config: SquadsConfig,
  ): Promise<Map<string, SquadProfile>> {
    const { db } = this.ctx;
    const searching = await listSearchingProfiles(db, guildId, game.id);
    if (searching.length === 0) return new Map();

    const busy = new Set<string>();
    for (const proposal of await listOpenSquadProposals(db, guildId)) {
      if (proposal.gameId !== game.id) continue;
      for (const userId of proposal.userIds) {
        if (!proposal.declinedIds.includes(userId)) busy.add(userId);
      }
    }
    const squads = await listSquads(db, guildId, { gameId: game.id, statuses: ['open', 'full'] });
    const squadIds = new Set(squads.map((squad) => squad.id));
    for (const request of await listPendingJoinRequests(db, guildId)) {
      if (squadIds.has(request.squadId)) busy.add(request.userId);
    }

    const pool = new Map<string, SquadProfile>();
    for (const profile of searching) {
      if (busy.has(profile.userId)) continue;
      const count = await countSquadsForUser(db, guildId, profile.userId);
      if (count >= config.maxSquadsPerUser) continue;
      pool.set(profile.userId, profile);
    }
    return pool;
  }

  /** Pedidos de entrada nos squads `open`; quem recebe um sai do `pool`. */
  private async fillVacancies(
    guild: Guild,
    game: SquadGame,
    pool: Map<string, SquadProfile>,
    blockedPairs: ReadonlySet<string>,
    recentRequests: ReadonlySet<string>,
  ): Promise<number> {
    const { db } = this.ctx;
    const squads = await listOpenSquadsByGame(db, guild.id, game.id);
    if (squads.length === 0) return 0;
    const pending = await listPendingJoinRequests(db, guild.id);

    let created = 0;
    for (const squad of squads) {
      if (pool.size === 0) break;
      if (!squad.textChannelId) continue;

      const members = await listSquadMembers(db, guild.id, squad.id);
      const waiting = pending.filter((request) => request.squadId === squad.id).length;
      const open = game.squadSize - members.length - waiting;
      if (open <= 0) continue;

      const memberProfiles = (
        await Promise.all(
          members.map((member) => getSquadProfile(db, guild.id, member.userId, game.id)),
        )
      ).filter((profile): profile is SquadProfile => profile !== null);

      const ranked = rankVacancyCandidates({
        slot: { day: squad.day, block: squad.block },
        fields: game.fields,
        memberIds: members.map((member) => member.userId),
        memberProfiles: memberProfiles.map(toMatchProfile),
        candidates: [...pool.values()]
          .filter((profile) => !recentRequests.has(joinRequestKey(squad.id, profile.userId)))
          .map(toMatchProfile),
        blockedPairs,
      });

      for (const fit of ranked.slice(0, open)) {
        pool.delete(fit.userId);
        try {
          if (await this.ctx.parts.requests.create(guild, squad, fit.userId, 'matcher')) created++;
        } catch (error) {
          log.error(
            { err: error, guildId: guild.id, squadId: squad.id, userId: fit.userId },
            'falha ao criar pedido de entrada',
          );
        }
      }
    }
    return created;
  }

  /**
   * Abre a proposta de um grupo e marca os perfis. `null` quando menos de duas
   * pessoas couberam na thread. O match manual chama direto, com a turma que o
   * admin escolheu: consentimento, prazo e cooldown ficam iguais aos do
   * automático porque o caminho é o mesmo.
   */
  async openProposal(
    guild: Guild,
    channel: TextChannel,
    game: SquadGame,
    config: SquadsConfig,
    group: SquadGroupProposal,
    options: OpenProposalOptions = {},
  ): Promise<SquadProposal | null> {
    const opened = await this.sendProposal(guild, channel, game, config, group, options);
    if (opened) {
      await markProfilesMatched(this.ctx.db, guild.id, game.id, opened.userIds, this.ctx.date());
    }
    return opened;
  }

  /**
   * Thread primeiro (`thread_id` é obrigatório), depois a mensagem com as
   * menções, depois a linha, e só então os botões: o `custom_id` leva o id da
   * proposta. Qualquer falha no meio apaga a thread, para ninguém ficar com
   * uma proposta sem botão. A nota vem por último e é opcional: se ela falhar,
   * a proposta já está de pé e só o log fica sabendo.
   */
  private async sendProposal(
    guild: Guild,
    channel: TextChannel,
    game: SquadGame,
    config: SquadsConfig,
    group: SquadGroupProposal,
    options: OpenProposalOptions,
  ): Promise<SquadProposal | null> {
    const { db } = this.ctx;
    const thread = await channel.threads.create({
      name: renderProposalThreadName(game.name),
      type: ChannelType.PrivateThread,
      invitable: false,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: `Proposta de squad de ${game.name}`,
    });

    let proposal: SquadProposal | null = null;
    try {
      const userIds: string[] = [];
      for (const userId of group.userIds) {
        try {
          await thread.members.add(userId);
          userIds.push(userId);
        } catch (error) {
          log.warn(
            { err: error, guildId: guild.id, userId },
            'não foi possível pôr o jogador na thread da proposta',
          );
        }
      }
      if (userIds.length < MIN_SQUAD_SIZE) {
        await thread.delete('Proposta de squad sem jogadores suficientes').catch(() => null);
        return null;
      }

      const expiresAt = new Date(this.ctx.now() + config.proposalTtlHours * HOUR_MS);
      const view = {
        game,
        slot: group.slot,
        blocks: config.blocks,
        squad: null,
        state: 'open' as const,
        embedColor: await this.ctx.embedColor(guild.id),
      };
      const message = await thread.send({
        ...proposalMessage({
          ...view,
          proposal: { id: '', userIds, acceptedIds: [], declinedIds: [], expiresAt },
          withButtons: false,
        }),
        // Só os jogadores. Mencionar um cargo numa thread privada puxa o cargo
        // inteiro para dentro dela: o `pingRoleId` é só da mensagem pública.
        content: userIds.map((id) => `<@${id}>`).join(' '),
        allowedMentions: { users: userIds },
      });

      proposal = await createSquadProposal(db, {
        guildId: guild.id,
        gameId: game.id,
        userIds,
        threadId: thread.id,
        expiresAt,
      });
      await message.edit(proposalMessage({ ...view, proposal }));
      const saved =
        (await setSquadProposalMessage(db, guild.id, proposal.id, message.id)) ?? proposal;
      if (options.note) {
        await thread.send(options.note).catch(
          logFailure('não foi possível mandar a nota na thread da proposta', {
            guildId: guild.id,
            proposalId: proposal.id,
          }),
        );
      }
      return saved;
    } catch (error) {
      if (proposal) {
        await closeSquadProposal(db, guild.id, proposal.id, this.ctx.date()).catch(() => null);
      }
      await thread.delete('Falha ao abrir a proposta de squad').catch(() => null);
      throw error;
    }
  }
}
