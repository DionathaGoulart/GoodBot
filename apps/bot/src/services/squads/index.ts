import { SquadContext } from './context';
import { MatcherService } from './matcher';
import { ProfileService } from './profiles';
import { ProposalService } from './proposals';
import { JoinRequestService } from './requests';
import { SessionService } from './sessions';
import { SquadLifecycleService } from './squads';

import type { SquadServiceDeps } from './context';
import type { MatchResult } from './matcher';
import type { ProfileResult } from './profiles';
import type { ProposalAcceptResult, ProposalDeclineResult } from './proposals';
import type { JoinRequestDecision, JoinRequestSource } from './requests';
import type { InactivityResult, RemindResult, StartResult } from './sessions';
import type { ArchiveOptions, RemoveMemberResult, RenameOptions, RenameResult } from './squads';
import type {
  Squad,
  SquadJoinRequest,
  SquadProfile,
  SquadProposal,
  SquadSession,
} from '@goodbot/db';
import type { SquadsConfig } from '@goodbot/shared';
import type { Guild } from 'discord.js';

export type { SquadServiceDeps } from './context';
export type { MatchResult } from './matcher';
export type { ProfileResult } from './profiles';
export type { ProposalAcceptResult, ProposalDeclineResult } from './proposals';
export type { JoinRequestDecision, JoinRequestSource } from './requests';
export type { InactivityResult, RemindResult, StartResult } from './sessions';
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
    };
  }

  /** Config do módulo; `UserFacingError` `MODULE_DISABLED` quando desligado. */
  requireConfig(guildId: string): Promise<SquadsConfig> {
    return this.ctx.requireConfig(guildId);
  }

  // ── perfis ────────────────────────────────────────────────────────────────

  saveProfile(
    guild: Guild,
    userId: string,
    gameId: string,
    input: unknown,
  ): Promise<ProfileResult> {
    return this.ctx.parts.profiles.save(guild, userId, gameId, input);
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

  // ── match ─────────────────────────────────────────────────────────────────

  runMatch(guildId: string, gameId: string): Promise<MatchResult> {
    return this.ctx.parts.matcher.runFor(guildId, gameId);
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

  checkInactivity(guild: Guild): Promise<InactivityResult> {
    return this.ctx.parts.sessions.checkInactivity(guild);
  }
}
