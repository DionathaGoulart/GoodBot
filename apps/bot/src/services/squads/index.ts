import { listSquadsForUser } from '@goodbot/db';

import { SquadContext } from './context';
import { ManualMatchService } from './manual';
import { MatcherService } from './matcher';
import { ProfileService } from './profiles';
import { ProposalService } from './proposals';
import { JoinRequestService } from './requests';
import { SearchService } from './search';
import { SessionService } from './sessions';
import { SquadLifecycleService } from './squads';

import type { SquadServiceDeps } from './context';
import type { ManualOutcome } from './manual';
import type { MatchResult } from './matcher';
import type { AvailabilityResult, ProfileDraft, ProfileForm, ProfileResult } from './profiles';
import type { ProposalAcceptResult, ProposalDeclineResult } from './proposals';
import type { JoinRequestDecision, JoinRequestSource } from './requests';
import type {
  JoinableSquad,
  JoinRequestSent,
  PublishedSearchMessage,
  PublishSearchOptions,
} from './search';
import type { DueSessions, InactivityResult, RemindResult, StartResult } from './sessions';
import type { ArchiveOptions, RemoveMemberResult, RenameOptions, RenameResult } from './squads';
import type {
  Squad,
  SquadGame,
  SquadJoinRequest,
  SquadProfile,
  SquadProposal,
  SquadSession,
} from '@goodbot/db';
import type {
  ManualMatchEvaluation,
  ProposeSquadManuallyInput,
  SquadAnswers,
  SquadManualCheckInput,
  SquadsConfig,
} from '@goodbot/shared';
import type { BaseMessageOptions, Guild } from 'discord.js';

export type { SquadServiceDeps } from './context';
export type { ManualOutcome } from './manual';
export type { MatchResult } from './matcher';
export type { AvailabilityResult, ProfileDraft, ProfileForm, ProfileResult } from './profiles';
export type { ProposalAcceptResult, ProposalDeclineResult } from './proposals';
export type { JoinRequestDecision, JoinRequestSource } from './requests';
export type {
  JoinableSquad,
  JoinRequestSent,
  PublishedSearchMessage,
  PublishSearchOptions,
} from './search';
export type { DueSessions, InactivityResult, RemindResult, StartResult } from './sessions';
export type { ArchiveOptions, RemoveMemberResult, RenameOptions, RenameResult } from './squads';

/**
 * Módulo `squads`: perfil por jogo, match por agenda, propostas sem líder,
 * pedidos de entrada, casa do squad (canal privado + voice do pool) e
 * sessões semanais. Uma fachada sobre as partes em `services/squads/`;
 * comandos, botões, o job e a API falam só com ela.
 *
 * Toda leitura e escrita passa o `guildId`. Erro que a pessoa resolve vira
 * `UserFacingError`; falha do Discord que não é culpa dela fica no log e o
 * fluxo segue.
 */
export class SquadService {
  private readonly ctx: SquadContext;

  constructor(deps: SquadServiceDeps) {
    this.ctx = new SquadContext(deps);
    this.ctx.parts = {
      profiles: new ProfileService(this.ctx),
      matcher: new MatcherService(this.ctx),
      proposals: new ProposalService(this.ctx),
      squads: new SquadLifecycleService(this.ctx),
      requests: new JoinRequestService(this.ctx),
      sessions: new SessionService(this.ctx),
      search: new SearchService(this.ctx),
      manual: new ManualMatchService(this.ctx),
    };
  }

  /** Config do módulo; `UserFacingError` `MODULE_DISABLED` quando desligado. */
  requireConfig(guildId: string): Promise<SquadsConfig> {
    return this.ctx.requireConfig(guildId);
  }

  // ── perfis ────────────────────────────────────────────────────────────────

  /** Jogos ligados, para autocomplete e para a mensagem fixa. */
  listGames(guildId: string): Promise<SquadGame[]> {
    return this.ctx.parts.profiles.listGames(guildId);
  }

  getProfileDraft(guildId: string, userId: string, gameId: string): Promise<ProfileDraft> {
    return this.ctx.parts.profiles.draft(guildId, userId, gameId);
  }

  /** O que abrir quando a pessoa pede o perfil: modal com os campos ou, sem campos, a grade. */
  profileForm(guildId: string, userId: string, gameId: string): Promise<ProfileForm> {
    return this.ctx.parts.profiles.form(guildId, userId, gameId);
  }

  /** A grade de horários com a máscara `mask`, ou com a grade salva quando ausente. */
  availabilityGrid(
    guildId: string,
    userId: string,
    gameId: string,
    mask?: number,
  ): Promise<BaseMessageOptions> {
    return this.ctx.parts.profiles.grid(guildId, userId, gameId, mask ?? null);
  }

  saveProfile(
    guild: Guild,
    userId: string,
    gameId: string,
    input: unknown,
  ): Promise<ProfileResult> {
    return this.ctx.parts.profiles.save(guild, userId, gameId, input);
  }

  saveAnswers(
    guild: Guild,
    userId: string,
    gameId: string,
    answers: SquadAnswers,
  ): Promise<SquadProfile> {
    return this.ctx.parts.profiles.saveAnswers(guild, userId, gameId, answers);
  }

  saveAvailability(
    guild: Guild,
    userId: string,
    gameId: string,
    availability: number,
  ): Promise<AvailabilityResult> {
    return this.ctx.parts.profiles.saveAvailability(guild, userId, gameId, availability);
  }

  setProfileStatus(
    guildId: string,
    userId: string,
    gameId: string,
    status: 'searching' | 'paused',
  ): Promise<ProfileResult> {
    return this.ctx.parts.profiles.setStatus(guildId, userId, gameId, status);
  }

  refreshProfileStatus(
    guildId: string,
    userId: string,
    gameId: string,
  ): Promise<SquadProfile | null> {
    return this.ctx.parts.profiles.refreshStatus(guildId, userId, gameId);
  }

  // ── busca ─────────────────────────────────────────────────────────────────

  publishSearchMessage(
    guild: Guild,
    actorId: string,
    options?: PublishSearchOptions,
  ): Promise<PublishedSearchMessage> {
    return this.ctx.parts.search.publishMessage(guild, actorId, options);
  }

  listJoinableSquads(guildId: string, userId: string, gameId: string): Promise<JoinableSquad[]> {
    return this.ctx.parts.search.listJoinable(guildId, userId, gameId);
  }

  requestToJoin(guild: Guild, userId: string, squadId: string): Promise<JoinRequestSent> {
    return this.ctx.parts.search.requestToJoin(guild, userId, squadId);
  }

  // ── match ─────────────────────────────────────────────────────────────────

  runMatch(guildId: string, gameId: string): Promise<MatchResult> {
    return this.ctx.parts.matcher.runFor(guildId, gameId);
  }

  /** Revisa a turma escolhida no painel, sem escrever nada. */
  checkManualMatch(
    guild: Guild,
    gameId: string,
    input: SquadManualCheckInput,
  ): Promise<ManualMatchEvaluation> {
    return this.ctx.parts.manual.check(guild, gameId, input);
  }

  /** Abre a proposta com a turma escolhida, se a revisão refeita na fila deixar. */
  proposeManually(
    guild: Guild,
    gameId: string,
    input: ProposeSquadManuallyInput,
  ): Promise<ManualOutcome<{ proposal: SquadProposal }>> {
    return this.ctx.parts.manual.propose(guild, gameId, input);
  }

  // ── propostas ─────────────────────────────────────────────────────────────

  acceptProposal(guild: Guild, proposalId: string, userId: string): Promise<ProposalAcceptResult> {
    return this.ctx.parts.proposals.accept(guild, proposalId, userId);
  }

  declineProposal(
    guild: Guild,
    proposalId: string,
    userId: string,
  ): Promise<ProposalDeclineResult> {
    return this.ctx.parts.proposals.decline(guild, proposalId, userId);
  }

  expireProposal(guild: Guild, proposal: SquadProposal): Promise<boolean> {
    return this.ctx.parts.proposals.expire(guild, proposal);
  }

  expireProposals(guildId: string): Promise<number> {
    return this.ctx.parts.proposals.expireDue(guildId);
  }

  // ── squads ────────────────────────────────────────────────────────────────

  /** Squads não arquivados da pessoa, na ordem em que ela entrou. */
  listSquadsForUser(guildId: string, userId: string): Promise<Squad[]> {
    return listSquadsForUser(this.ctx.db, guildId, userId);
  }

  removeMember(
    guild: Guild,
    squadId: string,
    userId: string,
    reason: string | null,
    options?: Parameters<SquadLifecycleService['removeMember']>[4],
  ): Promise<RemoveMemberResult> {
    return this.ctx.parts.squads.removeMember(guild, squadId, userId, reason, options);
  }

  archive(guild: Guild, squadId: string, options: ArchiveOptions): Promise<Squad | null> {
    return this.ctx.parts.squads.archive(guild, squadId, options);
  }

  rename(
    guild: Guild,
    squadId: string,
    name: string,
    actorId: string,
    options?: RenameOptions,
  ): Promise<RenameResult> {
    return this.ctx.parts.squads.rename(guild, squadId, name, actorId, options);
  }

  keepAlive(guild: Guild, squadId: string, userId: string): Promise<Squad> {
    return this.ctx.parts.squads.keepAlive(guild, squadId, userId);
  }

  // ── pedidos de entrada ────────────────────────────────────────────────────

  createJoinRequest(
    guild: Guild,
    squad: Squad,
    candidateUserId: string,
    source: JoinRequestSource,
  ): Promise<SquadJoinRequest | null> {
    return this.ctx.parts.requests.create(guild, squad, candidateUserId, source);
  }

  acceptJoinRequest(
    guild: Guild,
    requestId: string,
    memberUserId: string,
  ): Promise<JoinRequestDecision> {
    return this.ctx.parts.requests.accept(guild, requestId, memberUserId);
  }

  declineJoinRequest(
    guild: Guild,
    requestId: string,
    memberUserId: string,
  ): Promise<JoinRequestDecision> {
    return this.ctx.parts.requests.decline(guild, requestId, memberUserId);
  }

  expireRequests(guildId: string): Promise<number> {
    return this.ctx.parts.requests.expireRequests(guildId);
  }

  // ── sessões ───────────────────────────────────────────────────────────────

  ensureUpcomingSessions(guildId: string): Promise<SquadSession[]> {
    return this.ctx.parts.sessions.ensureUpcoming(guildId);
  }

  /** Sessões a lembrar, começar e liberar nesta passada do job. */
  dueSessions(guildId: string): Promise<DueSessions> {
    return this.ctx.parts.sessions.due(guildId);
  }

  remindSession(guild: Guild, session: SquadSession): Promise<RemindResult | null> {
    return this.ctx.parts.sessions.remind(guild, session);
  }

  reserveVoice(guild: Guild, session: SquadSession): Promise<string | null> {
    return this.ctx.parts.sessions.reserveVoice(guild, session);
  }

  startSession(guild: Guild, session: SquadSession): Promise<StartResult | null> {
    return this.ctx.parts.sessions.start(guild, session);
  }

  releaseVoice(guild: Guild, session: SquadSession): Promise<boolean> {
    return this.ctx.parts.sessions.release(guild, session);
  }

  vote(guild: Guild, sessionId: number, userId: string, going: boolean): Promise<SquadSession> {
    return this.ctx.parts.sessions.vote(guild, sessionId, userId, going);
  }

  /** Evento de voz: membro do squad no voice reservado conta como confirmação. */
  confirmVoicePresence(guild: Guild, voiceChannelId: string, userId: string): Promise<boolean> {
    return this.ctx.parts.sessions.confirmPresence(guild, voiceChannelId, userId);
  }

  /** Evento de voz: voice reservado vazio depois do início libera a reserva. */
  releaseEmptyVoice(guild: Guild, voiceChannelId: string): Promise<boolean> {
    return this.ctx.parts.sessions.releaseIfEmpty(guild, voiceChannelId);
  }

  checkInactivity(guild: Guild): Promise<InactivityResult> {
    return this.ctx.parts.sessions.checkInactivity(guild);
  }
}
