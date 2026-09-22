import { getSquad, listSquadsForUser } from '@goodbot/db';

import { CallService } from './calls';
import { SquadContext } from './context';
import { GuestService } from './guests';
import { GuideService } from './guide';
import { HistoryService } from './history';
import { ManualMatchService } from './manual';
import { MatcherService } from './matcher';
import { PlayerAdminService } from './players';
import { ProfileService } from './profiles';
import { ProposalService } from './proposals';
import { ReportService } from './reports';
import { JoinRequestService } from './requests';
import { SearchService } from './search';
import { SessionService } from './sessions';
import { SquadLifecycleService } from './squads';

import type { CallSent } from './calls';
import type { SquadServiceDeps } from './context';
import type { GuestSent } from './guests';
import type { SquadHistoryView } from './history';
import type { ManualOutcome } from './manual';
import type { MatchResult } from './matcher';
import type { Notified } from './players';
import type { AvailabilityResult, ProfileDraft, ProfileForm, ProfileResult } from './profiles';
import type { ProposalAcceptResult, ProposalDeclineResult } from './proposals';
import type { InviteAnswer, InviteTarget, JoinVoteResult, MemberInviteSent } from './requests';
import type {
  CallRequestSent,
  JoinableSquad,
  JoinRequestSent,
  PublishedSearchMessage,
  PublishSearchOptions,
} from './search';
import type {
  CancelResult,
  DueSessions,
  InactivityResult,
  RemindResult,
  RescheduleResult,
  ScheduleResult,
  StartResult,
  SweepResult,
} from './sessions';
import type { ArchiveOptions, RemoveMemberResult, RenameOptions, RenameResult } from './squads';
import type { Squad, SquadGame, SquadProfile, SquadProposal, SquadSession } from '@goodbot/db';
import type {
  AuditSource,
  DeleteSquadProfileInput,
  EditSquadProfileAnswersInput,
  ManualMatchEvaluation,
  ProposeSquadManuallyInput,
  RemoveSquadMemberInput,
  SetSquadProfileStatusInput,
  SquadAnswers,
  SquadManualCheckInput,
  SquadsConfig,
} from '@goodbot/shared';
import type { BaseMessageOptions, Guild, ModalBuilder } from 'discord.js';

export type { CallSent } from './calls';
export type { SquadServiceDeps } from './context';
export type { GuestSent } from './guests';
export type { SquadHistoryView } from './history';
export type { ManualOutcome } from './manual';
export type { MatchResult } from './matcher';
export type { Notified } from './players';
export type { AvailabilityResult, ProfileDraft, ProfileForm, ProfileResult } from './profiles';
export type { ProposalAcceptResult, ProposalDeclineResult } from './proposals';
export type {
  InviteAnswer,
  InviteResult,
  InviteTarget,
  JoinVoteResult,
  MemberInviteSent,
} from './requests';
export type {
  CallRequestSent,
  JoinableSquad,
  JoinRequestSent,
  PublishedSearchMessage,
  PublishSearchOptions,
} from './search';
export type {
  CancelResult,
  DueSessions,
  InactivityResult,
  RemindResult,
  RescheduleResult,
  ScheduleResult,
  StartResult,
  SweepResult,
} from './sessions';
export type { ArchiveOptions, RemoveMemberResult, RenameOptions, RenameResult } from './squads';

/**
 * Módulo `squads`: perfil por jogo, match por agenda, propostas sem líder,
 * entrada em squad existente (convite e votação), casa do squad (canal privado com guia fixo + voice do
 * pool), jogatinas sob demanda com chamada pública e o histórico delas. Uma fachada sobre as partes em
 * `services/squads/`; comandos, botões, o job e a API falam só com ela.
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
      calls: new CallService(this.ctx),
      guests: new GuestService(this.ctx),
      reports: new ReportService(this.ctx),
      history: new HistoryService(this.ctx),
      guide: new GuideService(this.ctx),
      search: new SearchService(this.ctx),
      manual: new ManualMatchService(this.ctx),
      players: new PlayerAdminService(this.ctx),
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

  // ── gestão de jogadores pelo painel ───────────────────────────────────────

  setProfileStatusAsAdmin(
    guild: Guild,
    gameId: string,
    userId: string,
    input: SetSquadProfileStatusInput,
  ): Promise<ProfileResult & Notified> {
    return this.ctx.parts.players.setStatus(guild, gameId, userId, input);
  }

  editProfileAnswersAsAdmin(
    guild: Guild,
    gameId: string,
    userId: string,
    input: EditSquadProfileAnswersInput,
  ): Promise<{ profile: SquadProfile } & Notified> {
    return this.ctx.parts.players.editAnswers(guild, gameId, userId, input);
  }

  deleteProfileAsAdmin(
    guild: Guild,
    gameId: string,
    userId: string,
    input: DeleteSquadProfileInput,
  ): Promise<{ deleted: SquadProfile } & Notified> {
    return this.ctx.parts.players.deleteProfile(guild, gameId, userId, input);
  }

  removeMemberAsAdmin(
    guild: Guild,
    squadId: string,
    userId: string,
    input: RemoveSquadMemberInput,
  ): Promise<RemoveMemberResult & Notified> {
    return this.ctx.parts.players.removeFromSquad(guild, squadId, userId, input);
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

  getSquad(guildId: string, squadId: string): Promise<Squad | null> {
    return getSquad(this.ctx.db, guildId, squadId);
  }

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

  // ── entrada em squad existente ────────────────────────────────────────────

  /** `/squad convidar` e o CONVIDAR do guia: convite de membro, que entra sem voto. */
  inviteToSquad(
    guild: Guild,
    squadId: string,
    inviterId: string,
    target: InviteTarget,
    source: AuditSource,
  ): Promise<MemberInviteSent> {
    return this.ctx.parts.requests.inviteByMember(guild, squadId, inviterId, target, source);
  }

  /** ENTRAR ou PASSO, na thread do convite. */
  answerInvite(
    guild: Guild,
    requestId: string,
    userId: string,
    accept: boolean,
  ): Promise<InviteAnswer> {
    return this.ctx.parts.requests.answer(guild, requestId, userId, accept);
  }

  /** A FAVOR ou CONTRA, na votação do canal do squad. */
  voteJoinRequest(
    guild: Guild,
    requestId: string,
    memberUserId: string,
    inFavor: boolean,
  ): Promise<JoinVoteResult> {
    return this.ctx.parts.requests.vote(guild, requestId, memberUserId, inFavor);
  }

  /** Convites sem resposta e votações vencidas. Devolve quantos fecharam. */
  expireRequests(guildId: string): Promise<number> {
    return this.ctx.parts.requests.expireDue(guildId);
  }

  // ── jogatinas ─────────────────────────────────────────────────────────────

  /** `/bora` e o modal do BORA: o "quando" digitado, no fuso da guild. */
  scheduleSession(
    guild: Guild,
    squadId: string,
    userId: string,
    when: string,
    source: AuditSource,
  ): Promise<ScheduleResult> {
    return this.ctx.parts.sessions.scheduleFromText(guild, squadId, userId, when, source);
  }

  cancelSession(
    guild: Guild,
    sessionId: number,
    userId: string,
    source: AuditSource,
  ): Promise<CancelResult> {
    return this.ctx.parts.sessions.cancel(guild, sessionId, userId, source);
  }

  /** O modal do REMARCAR, depois de conferir que quem clicou pode remarcar. */
  rescheduleForm(guild: Guild, sessionId: number, userId: string): Promise<ModalBuilder> {
    return this.ctx.parts.sessions.rescheduleForm(guild, sessionId, userId);
  }

  /** REMARCAR: o horário novo digitado, no fuso da guild. */
  rescheduleSession(
    guild: Guild,
    sessionId: number,
    userId: string,
    when: string,
    source: AuditSource,
  ): Promise<RescheduleResult> {
    return this.ctx.parts.sessions.rescheduleFromText(guild, sessionId, userId, when, source);
  }

  /** REPETIR: a mesma hora na semana seguinte. */
  repeatSession(
    guild: Guild,
    sessionId: number,
    userId: string,
    source: AuditSource,
  ): Promise<ScheduleResult> {
    return this.ctx.parts.sessions.repeat(guild, sessionId, userId, source);
  }

  /** Jogatinas a lembrar, começar e liberar nesta passada do job. */
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

  /** Evento de voz: quem saiu de um voice do pool fecha a presença aberta. */
  recordVoiceLeave(guild: Guild, userId: string): Promise<number> {
    return this.ctx.parts.sessions.recordLeave(guild, userId);
  }

  /** Evento de voz: voice reservado vazio depois do início libera a reserva. */
  releaseEmptyVoice(guild: Guild, voiceChannelId: string): Promise<boolean> {
    return this.ctx.parts.sessions.releaseIfEmpty(guild, voiceChannelId);
  }

  /** Job: acerta a presença com quem está em voice agora (o que o evento de voz não viu). */
  sweepPresence(guild: Guild): Promise<SweepResult> {
    return this.ctx.parts.sessions.sweepPresence(guild);
  }

  /** Job: adota ou apaga o voice temporário de uma criação que não terminou. */
  reconcileTemporaryVoices(guild: Guild): Promise<number> {
    return this.ctx.parts.sessions.reconcileTemporaryVoices(guild);
  }

  /** Evento de voz: o canal é um voice temporário de jogatina? Em memória depois da 1ª consulta. */
  isTemporaryVoice(guildId: string, channelId: string): Promise<boolean> {
    return this.ctx.parts.sessions.isTemporaryVoice(guildId, channelId);
  }

  checkInactivity(guild: Guild): Promise<InactivityResult> {
    return this.ctx.parts.sessions.checkInactivity(guild);
  }

  // ── chamada pública, convidados e histórico ───────────────────────────────

  /** CHAMAR GENTE na mensagem da jogatina. */
  callForPlayers(
    guild: Guild,
    sessionId: number,
    userId: string,
    source: AuditSource,
  ): Promise<CallSent> {
    return this.ctx.parts.calls.call(guild, sessionId, userId, source);
  }

  /** Job: tira do ar a chamada pública das jogatinas que acabaram. */
  closeFinishedCalls(guild: Guild): Promise<number> {
    return this.ctx.parts.calls.closeFinished(guild);
  }

  /** Job: a mensagem das jogatinas que acabaram vira o relatório do que rolou. */
  reportFinishedSessions(guild: Guild): Promise<number> {
    return this.ctx.parts.reports.reportFinished(guild);
  }

  /** CHAMAR GENTE no guia: a próxima jogatina com lugar. */
  callForNextSession(
    guild: Guild,
    squadId: string,
    userId: string,
    source: AuditSource,
  ): Promise<CallSent> {
    return this.ctx.parts.calls.callNext(guild, squadId, userId, source);
  }

  /** TRAZER CONVIDADO: o select de pessoa, depois de conferir que quem clicou pode trazer. */
  guestPickMessage(guild: Guild, sessionId: number, userId: string): Promise<BaseMessageOptions> {
    return this.ctx.parts.guests.pickMessage(guild.id, sessionId, userId);
  }

  /** TRAZER CONVIDADO: a pessoa escolhida joga só esta jogatina, sem entrar no squad. */
  bringGuest(
    guild: Guild,
    sessionId: number,
    userId: string,
    target: InviteTarget,
    source: AuditSource,
  ): Promise<GuestSent> {
    return this.ctx.parts.guests.bring(guild, sessionId, userId, target, source);
  }

  /** ENTRAR na chamada pública: pedido de entrada em votação, ligado à jogatina. */
  requestFromCall(guild: Guild, userId: string, sessionId: number): Promise<CallRequestSent> {
    return this.ctx.parts.search.requestFromCall(guild, userId, sessionId);
  }

  /** O histórico de jogatinas de cada squad pedido (o painel lê por aqui). */
  historyFor(guildId: string, squadIds: readonly string[]): Promise<Map<string, SquadHistoryView>> {
    return this.ctx.parts.history.load(guildId, squadIds);
  }

  // ── guia ──────────────────────────────────────────────────────────────────

  /** Passo diário: publica o guia que falta e reedita os outros. */
  syncGuides(guild: Guild): Promise<number> {
    return this.ctx.parts.guide.syncAll(guild);
  }
}
