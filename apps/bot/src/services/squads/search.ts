import {
  getSquad,
  getSquadProfile,
  getSquadSession,
  listOpenSquadsByGame,
  listOpenJoinRequests,
  listRecentJoinRequestKeys,
  listSquadMembers,
  setModuleConfig,
} from '@goodbot/db';
import { DAY_MS, joinRequestKey, UserFacingError } from '@goodbot/shared';
import { ChannelType } from 'discord.js';

import { discordErrorCode, log } from './context';
import { searchMessage } from './embeds';
import { rankVacancyCandidates, toMatchProfile } from './matcher';

import type { SquadContext } from './context';
import type {
  Squad,
  SquadGame,
  SquadJoinRequest,
  SquadMember,
  SquadProfile,
  SquadSession,
} from '@goodbot/db';
import type { AuditSource, SquadsConfig } from '@goodbot/shared';
import type { Guild, Message, TextChannel } from 'discord.js';

const DISCORD_MISSING_ACCESS = 50001;
const DISCORD_MISSING_PERMISSIONS = 50013;

export interface JoinableSquad {
  squad: Squad;
  memberCount: number;
  score: number;
  /** `formatHistory` do squad: quem procura quer saber se o squad joga de verdade. */
  history: string;
}

export interface PublishedSearchMessage {
  channelId: string;
  messageId: string;
}

export interface PublishSearchOptions {
  /** Sem canal, usa o `searchChannelId` do config. */
  channelId?: string;
  source?: AuditSource;
}

export interface JoinRequestSent {
  request: SquadJoinRequest;
  squad: Squad;
}

export interface CallRequestSent extends JoinRequestSent {
  session: SquadSession;
}

/**
 * O que a pessoa faz por conta própria: a mensagem fixa, a lista de vagas, o
 * pedido manual e o ENTRAR de uma chamada pública.
 */
export class SearchService {
  constructor(private readonly ctx: SquadContext) {}

  /**
   * Publica a mensagem fixa, ou reedita a que já existe no mesmo canal. O id
   * vai para o config porque é ele que diz, depois de um restart, qual
   * mensagem reeditar; o canal também, para as threads de proposta nascerem
   * ao lado da mensagem.
   */
  async publishMessage(
    guild: Guild,
    actorId: string,
    options: PublishSearchOptions = {},
  ): Promise<PublishedSearchMessage> {
    const { db } = this.ctx;
    const config = await this.ctx.requireConfig(guild.id);
    const targetId = options.channelId ?? config.searchChannelId;
    if (!targetId) {
      throw new UserFacingError('Escolha o canal de busca no painel antes de publicar.', {
        code: 'SQUADS_NO_SEARCH_CHANNEL',
      });
    }
    const found = await this.ctx.fetchChannel(guild, targetId);
    if (found?.type !== ChannelType.GuildText) {
      throw new UserFacingError('O canal de busca precisa ser um canal de texto.', {
        code: 'BAD_CHANNEL',
      });
    }
    const channel = found as TextChannel;

    const games = await this.ctx.parts.profiles.listGames(guild.id);
    if (games.length === 0) {
      throw new UserFacingError(
        'Cadastre pelo menos um jogo no painel antes de publicar a mensagem de busca.',
        { code: 'SQUADS_NO_GAMES' },
      );
    }

    const body = searchMessage({
      games,
      pingRoleId: config.pingRoleId,
      embedColor: await this.ctx.embedColor(guild.id),
    });
    const existing =
      config.searchMessageId && config.searchChannelId === channel.id
        ? await channel.messages.fetch(config.searchMessageId).catch(() => null)
        : null;

    let message: Message;
    try {
      message = existing ? await existing.edit(body) : await channel.send(body);
    } catch (error) {
      const code = discordErrorCode(error);
      if (code === DISCORD_MISSING_ACCESS || code === DISCORD_MISSING_PERMISSIONS) {
        throw new UserFacingError(`Não tenho permissão para escrever em ${channel.toString()}.`, {
          code: 'MISSING_PERMISSIONS',
          cause: error,
        });
      }
      throw error;
    }

    await setModuleConfig(
      db,
      guild.id,
      'squads',
      { ...config, searchChannelId: channel.id, searchMessageId: message.id },
      actorId,
    );
    this.ctx.config.publishInvalidate(guild.id, 'squads');

    this.ctx.record({
      guildId: guild.id,
      action: 'squad.search_message.publish',
      source: options.source ?? 'command',
      actor: actorId,
      target: { type: 'channel', id: channel.id },
      after: { messageId: message.id, edited: existing !== null },
    });
    return { channelId: channel.id, messageId: message.id };
  }

  /**
   * Squads `open` do jogo em que a pessoa cabe agora: vaga livre, grade que
   * dá party com os membros, nenhum campo `hard` batendo de frente com um
   * membro e nenhum convite ou pedido dela para aquele squad aberto ou recente.
   * Melhor nota primeiro.
   */
  async listJoinable(guildId: string, userId: string, gameId: string): Promise<JoinableSquad[]> {
    const { db } = this.ctx;
    const config = await this.ctx.requireConfig(guildId);
    const game = await this.ctx.parts.profiles.requireGame(guildId, gameId);
    const profile = await this.requireProfile(guildId, userId, gameId);
    await this.ctx.parts.squads.assertCanJoinAnother(guildId, userId, config);

    const since = new Date(this.ctx.now() - config.reproposeCooldownDays * DAY_MS);
    const [squads, recent, pending] = await Promise.all([
      listOpenSquadsByGame(db, guildId, gameId),
      listRecentJoinRequestKeys(db, guildId, since),
      listOpenJoinRequests(db, guildId),
    ]);
    const asked = new Set(recent);
    for (const request of pending) asked.add(joinRequestKey(request.squadId, request.userId));

    const fits: Omit<JoinableSquad, 'history'>[] = [];
    for (const squad of squads) {
      if (!squad.textChannelId || asked.has(joinRequestKey(squad.id, userId))) continue;
      const members = await listSquadMembers(db, guildId, squad.id);
      if (members.length >= game.groupSize) continue;
      if (members.some((member) => member.userId === userId)) continue;
      const score = await this.fitScore(guildId, game, squad, members, profile);
      if (score !== null) fits.push({ squad, memberCount: members.length, score });
    }
    const histories = await this.ctx.parts.history.load(
      guildId,
      fits.map((fit) => fit.squad.id),
    );
    const joinable = fits.map((fit) => ({
      ...fit,
      history: histories.get(fit.squad.id)?.text ?? '',
    }));
    return joinable.sort(
      (a, b) =>
        b.score - a.score || (a.squad.name < b.squad.name ? -1 : a.squad.name > b.squad.name ? 1 : 0),
    );
  }

  /**
   * Pedido manual para entrar num squad. Passa pelas mesmas regras da lista,
   * com uma diferença: o cooldown de dupla do matcher não vale aqui, porque
   * foi a própria pessoa quem escolheu o squad. O clique já é o aceite dela,
   * então o pedido pula o convite e vai direto para a votação do squad.
   */
  async requestToJoin(guild: Guild, userId: string, squadId: string): Promise<JoinRequestSent> {
    const { db } = this.ctx;
    const config = await this.ctx.requireConfig(guild.id);
    const squad = await getSquad(db, guild.id, squadId);
    if (!squad || squad.status === 'archived') {
      throw new UserFacingError('Este squad foi encerrado.', { code: 'SQUAD_ARCHIVED' });
    }
    const game = await this.ctx.parts.profiles.requireGame(guild.id, squad.gameId);
    const members = await listSquadMembers(db, guild.id, squad.id);
    await this.assertCanAsk(guild.id, squad, game, members, userId, config);
    const profile = await this.requireProfile(guild.id, userId, game.id);
    if ((await this.fitScore(guild.id, game, squad, members, profile)) === null) {
      throw new UserFacingError('Seus horários ou respostas não combinam com este squad.', {
        code: 'NOT_COMPATIBLE',
      });
    }
    return { request: await this.sendRequest(guild, squad, userId), squad };
  }

  /**
   * ENTRAR na chamada pública de uma jogatina: o mesmo pedido em votação do
   * `/squad procurar`, com duas diferenças. Não exige perfil nem grade que
   * combine, porque a pessoa respondeu a uma jogatina com dia e hora (o
   * horário já bate); e o pedido guarda a jogatina, para a votação dizer de
   * onde a pessoa veio e quem entra já ficar como "vou" nela. Chamada de
   * jogatina que começou ou foi cancelada sai do ar no clique.
   */
  async requestFromCall(guild: Guild, userId: string, sessionId: number): Promise<CallRequestSent> {
    const { db } = this.ctx;
    const config = await this.ctx.requireConfig(guild.id);
    const session = await getSquadSession(db, guild.id, sessionId);
    if (!session) {
      throw new UserFacingError('Esta jogatina não existe mais.', { code: 'SESSION_NOT_FOUND' });
    }
    const squad = await getSquad(db, guild.id, session.squadId);
    const over =
      !squad ||
      squad.status === 'archived' ||
      session.cancelledAt !== null ||
      session.startedAt !== null ||
      session.startsAt.getTime() <= this.ctx.now();
    if (over) {
      await this.ctx.parts.calls.close(guild, session);
      throw new UserFacingError(
        'Esta chamada acabou: a jogatina já começou, foi cancelada ou o squad foi encerrado.',
        { code: 'CALL_CLOSED' },
      );
    }
    const game = await this.ctx.parts.profiles.requireGame(guild.id, squad.gameId);
    const members = await listSquadMembers(db, guild.id, squad.id);
    await this.assertCanAsk(guild.id, squad, game, members, userId, config);
    const request = await this.sendRequest(guild, squad, userId, session.id);
    return { request, squad, session };
  }

  /**
   * O que vale para todo pedido feito pela própria pessoa: não ser do squad,
   * vaga livre, teto de squads, nenhum convite ou pedido aberto para o mesmo
   * squad e nenhum recente dentro do cooldown.
   */
  private async assertCanAsk(
    guildId: string,
    squad: Squad,
    game: SquadGame,
    members: readonly SquadMember[],
    userId: string,
    config: SquadsConfig,
  ): Promise<void> {
    const { db } = this.ctx;
    if (members.some((member) => member.userId === userId)) {
      throw new UserFacingError('Você já está neste squad.', { code: 'ALREADY_MEMBER' });
    }
    if (squad.status === 'full' || members.length >= game.groupSize) {
      throw new UserFacingError('O squad já encheu.', { code: 'SQUAD_FULL' });
    }
    await this.ctx.parts.squads.assertCanJoinAnother(guildId, userId, config);

    const open = await listOpenJoinRequests(db, guildId, squad.id);
    const mine = open.find((request) => request.userId === userId);
    if (mine) {
      throw new UserFacingError(
        mine.status === 'invited'
          ? 'Você já tem um convite deste squad esperando resposta: responda na conversa privada do convite.'
          : 'Seu pedido já está com o squad. Agora é com eles.',
        { code: 'REQUEST_PENDING' },
      );
    }
    const since = new Date(this.ctx.now() - config.reproposeCooldownDays * DAY_MS);
    const recent = await listRecentJoinRequestKeys(db, guildId, since);
    if (recent.includes(joinRequestKey(squad.id, userId))) {
      throw new UserFacingError(
        'Você já pediu para entrar neste squad há pouco tempo. Tente outro squad.',
        { code: 'REQUEST_COOLDOWN' },
      );
    }
  }

  private async sendRequest(
    guild: Guild,
    squad: Squad,
    userId: string,
    sessionId?: number,
  ): Promise<SquadJoinRequest> {
    const sent = await this.ctx.parts.requests.open(
      guild,
      squad,
      userId,
      sessionId === undefined ? {} : { sessionId },
    );
    if (sent.outcome === 'exists') {
      throw new UserFacingError('Seu pedido já está com o squad. Agora é com eles.', {
        code: 'REQUEST_PENDING',
      });
    }
    if (sent.outcome === 'failed') {
      log.warn({ guildId: guild.id, squadId: squad.id, userId }, 'pedido manual não saiu');
      throw new UserFacingError(
        'Não consegui mandar o pedido para o squad agora. Tente de novo mais tarde.',
        { code: 'REQUEST_FAILED' },
      );
    }
    return sent.request;
  }

  private async requireProfile(
    guildId: string,
    userId: string,
    gameId: string,
  ): Promise<SquadProfile> {
    const profile = await getSquadProfile(this.ctx.db, guildId, userId, gameId);
    if (!profile || profile.availability === 0) {
      throw new UserFacingError('Monte seu perfil deste jogo primeiro, com /squad perfil.', {
        code: 'PROFILE_NOT_FOUND',
      });
    }
    return profile;
  }

  /** A nota da pessoa na vaga do squad; `null` quando ela não cabe. */
  private async fitScore(
    guildId: string,
    game: SquadGame,
    squad: Squad,
    members: readonly SquadMember[],
    profile: SquadProfile,
  ): Promise<number | null> {
    const memberProfiles = (
      await Promise.all(
        members.map((member) => getSquadProfile(this.ctx.db, guildId, member.userId, game.id)),
      )
    ).filter((row): row is SquadProfile => row !== null);
    const [fit] = rankVacancyCandidates({
      partySize: game.partySize,
      fields: game.fields,
      memberIds: members.map((member) => member.userId),
      memberProfiles: memberProfiles.map(toMatchProfile),
      candidates: [toMatchProfile(profile)],
      blockedPairs: new Set(),
    });
    return fit ? fit.score : null;
  }
}
