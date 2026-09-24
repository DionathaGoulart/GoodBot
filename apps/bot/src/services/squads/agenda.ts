import {
  countOpenLfgSessions,
  createLfgSession,
  getLfgSession,
  listUpcomingLfgSessions,
  mutateLfgRoster,
  updateLfgSession,
} from '@goodbot/db';
import {
  acceptRequest,
  freeSlots,
  joinRoster,
  LFG_MAX_OPEN_SESSIONS,
  LFG_MAX_SESSIONS_PER_HOST,
  leaveRoster,
  MINUTE_MS,
  parseWhen,
  rejectRequest,
  requestedEntries,
  SECOND_MS,
  seatedEntries,
  toLocalDateTime,
  UserFacingError,
  waitingEntries,
} from '@goodbot/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  DiscordAPIError,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  ThreadAutoArchiveDuration,
} from 'discord.js';

import { agendaId, requestId } from './ids';
import { infoEmbed } from '../../lib/embeds';
import { childLogger } from '../../logger';

import type { AuditService } from '../audit';
import type { ConfigService } from '../config';
import type { Db, LfgSession } from '@goodbot/db';
import type {
  AuditSource,
  JoinOutcome,
  LfgMemberStatus,
  LfgVisibility,
  Roster,
  SquadsConfig,
} from '@goodbot/shared';
import type { Client, Guild, GuildMember, TextChannel } from 'discord.js';

const log = childLogger('squads');

/** Uma edição por jogatina a cada tanto: uma rajada de VOU vira uma edição só. */
export const AGENDA_RENDER_MS = 1.5 * SECOND_MS;
/** Quanto tempo o modal preenchido espera o clique em ABERTA ou FECHADA. */
export const DRAFT_TTL_MS = 15 * MINUTE_MS;
/** Quantos nomes cada lista mostra antes do "e mais N". */
const LIST_SHOWN = 15;
/** Teto do nome de thread no Discord. */
const THREAD_NAME_MAX = 100;

const AGENDA_PERMISSIONS = [
  ['Ver canal', PermissionFlagsBits.ViewChannel],
  ['Enviar mensagens', PermissionFlagsBits.SendMessages],
  ['Inserir links', PermissionFlagsBits.EmbedLinks],
  ['Criar threads públicas', PermissionFlagsBits.CreatePublicThreads],
  ['Enviar mensagens em threads', PermissionFlagsBits.SendMessagesInThreads],
] as const;

// ── Regras puras ────────────────────────────────────────────────────────────

/** O modal preenchido, à espera de ABERTA ou FECHADA. */
export interface ScheduleDraft {
  startsAt: Date;
  slots: number;
  note: string | null;
}

/** O pedaço da jogatina que a mensagem mostra. */
export type AgendaSession = Pick<LfgSession, 'id' | 'hostId' | 'startsAt' | 'note' | 'status'>;

export function messageLink(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function unix(at: Date): string {
  return String(Math.floor(at.getTime() / 1000));
}

/** `<@a>\n<@b>`, cortando em `LIST_SHOWN` para o campo não passar de 1024. */
export function mentionList(userIds: readonly string[]): string {
  const shown = userIds.slice(0, LIST_SHOWN).map((id) => `<@${id}>`);
  const rest = userIds.length - shown.length;
  return rest > 0 ? `${shown.join('\n')}\ne mais ${String(rest)}` : shown.join('\n');
}

/** O texto e o estilo do botão de entrar, conforme a jogatina está. */
export function joinLabel(roster: Roster): string {
  if (roster.visibility === 'closed') return 'PEDIR VAGA';
  return freeSlots(roster) > 0 ? 'VOU' : 'ENTRAR NA ESPERA';
}

const VISIBILITY_LABEL: Record<LfgVisibility, string> = { open: 'aberta', closed: 'fechada' };

/**
 * A mensagem da jogatina no canal da agenda. Menção em embed não notifica
 * ninguém: a lista é só leitura. Encerrada ou cancelada perde os botões.
 */
export function agendaMessage(session: AgendaSession, roster: Roster, embedColor?: number) {
  const seated = seatedEntries(roster).map((entry) => entry.userId);
  const count = String(seated.length);

  if (session.status === 'done' || session.status === 'cancelled') {
    const done = session.status === 'done';
    const embed = infoEmbed(
      {
        title: done ? 'Jogatina · rolou' : 'Jogatina · cancelada',
        description:
          `<t:${unix(session.startsAt)}:F>, marcada por <@${session.hostId}>.\n\n` +
          (done ? `Foram ${count}: ${seated.map((id) => `<@${id}>`).join(' ')}` : 'Não rolou.'),
      },
      embedColor,
    );
    return { embeds: [embed], components: [] };
  }

  const at = unix(session.startsAt);
  const note = session.note ? `\n\n> ${session.note.replace(/\n/g, '\n> ')}` : '';
  const live = session.status === 'live' ? '\n**Rolando agora.**' : '';
  const fields = [{ name: `Vão (${count}/${String(roster.slots)})`, value: mentionList(seated) }];
  const waiting = waitingEntries(roster).map((entry) => entry.userId);
  if (waiting.length > 0) {
    fields.push({
      name: `Lista de espera (${String(waiting.length)})`,
      value: mentionList(waiting),
    });
  }
  const requested = requestedEntries(roster).map((entry) => entry.userId);
  if (requested.length > 0) {
    fields.push({
      name: `Pediram vaga (${String(requested.length)})`,
      value: mentionList(requested),
    });
  }
  const embed = infoEmbed(
    {
      title: `Jogatina · ${VISIBILITY_LABEL[roster.visibility]}`,
      description: `<t:${at}:F> (<t:${at}:R>), marcada por <@${session.hostId}>.${live}${note}`,
      fields,
      footer:
        roster.visibility === 'open'
          ? 'Aberta: quem clica em VOU entra na hora. Lotou, entra na espera.'
          : 'Fechada: quem marcou aprova cada pedido de vaga.',
    },
    embedColor,
  );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(agendaId('join', session.id))
      .setLabel(joinLabel(roster))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(agendaId('leave', session.id))
      .setLabel('SAIR')
      .setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

/** `Jogatina 24/09 21:00`, no fuso da guild. */
export function threadName(startsAt: Date, timeZone: string): string {
  const local = toLocalDateTime(startsAt, timeZone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `Jogatina ${pad(local.day)}/${pad(local.month)} ${pad(local.hour)}:${pad(local.minute)}`.slice(
    0,
    THREAD_NAME_MAX,
  );
}

/** O pedido de vaga que chega ao host, com ACEITAR e RECUSAR. */
export function requestMessage(
  guild: Pick<Guild, 'id' | 'name'>,
  session: Pick<LfgSession, 'id' | 'startsAt'>,
  userId: string,
  link: string | null,
) {
  const at = unix(session.startsAt);
  const where = link ? `[jogatina de <t:${at}:F>](${link})` : `jogatina de <t:${at}:F>`;
  const embed = infoEmbed({
    title: 'Pedido de vaga',
    description: `<@${userId}> pediu vaga na sua ${where} em **${guild.name}**.`,
  });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(requestId('ok', guild.id, session.id, userId))
      .setLabel('ACEITAR')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(requestId('no', guild.id, session.id, userId))
      .setLabel('RECUSAR')
      .setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

export const JOIN_TEXT: Record<JoinOutcome, string> = {
  going: 'Pronto: você está na lista.',
  waiting:
    'Lotou, então você entrou na **lista de espera**. Abrindo vaga, você sobe e eu te aviso.',
  requested: 'Pedido enviado. Quem marcou decide, e eu te aviso da resposta por DM.',
};

export const LEAVE_TEXT: Record<Exclude<LfgMemberStatus, 'host'>, string> = {
  going: 'Pronto: você saiu da lista.',
  waiting: 'Pronto: você saiu da lista de espera.',
  requested: 'Pronto: seu pedido foi retirado.',
};

/** Rascunhos do modal, por pessoa em cada guild. Memória: um restart pede o modal de novo. */
export class DraftBook {
  private readonly drafts = new Map<string, { draft: ScheduleDraft; expiresAt: number }>();

  constructor(private readonly ttlMs = DRAFT_TTL_MS) {}

  put(guildId: string, userId: string, draft: ScheduleDraft, now: number): void {
    for (const [key, entry] of this.drafts) if (entry.expiresAt <= now) this.drafts.delete(key);
    this.drafts.set(`${guildId}:${userId}`, { draft, expiresAt: now + this.ttlMs });
  }

  take(guildId: string, userId: string, now: number): ScheduleDraft | null {
    const key = `${guildId}:${userId}`;
    const entry = this.drafts.get(key);
    this.drafts.delete(key);
    return entry && entry.expiresAt > now ? entry.draft : null;
  }
}

// ── O service ───────────────────────────────────────────────────────────────

/** O que o painel lista de uma jogatina. */
export interface AgendaSummary {
  id: string;
  hostId: string;
  startsAt: number;
  url: string;
}

export interface ScheduledSession {
  sessionId: string;
  startsAt: Date;
  url: string;
}

export interface RequestAnswerResult {
  outcome: 'going' | 'waiting' | 'rejected';
  userId: string;
}

export interface SquadAgendaDeps {
  client: Client;
  db: Db;
  config: Pick<ConfigService, 'get' | 'getSettings'>;
  audit: Pick<AuditService, 'record'>;
  /** A agenda mudou (jogatina nova, remarcada, encerrada): o painel se refaz. */
  onChange: (guildId: string) => void;
  now?: () => number;
  renderMs?: number;
}

function isMissingAccess(error: unknown): boolean {
  return (
    error instanceof DiscordAPIError &&
    (error.code === RESTJSONErrorCodes.MissingAccess ||
      error.code === RESTJSONErrorCodes.MissingPermissions)
  );
}

/**
 * A agenda de jogatinas (PRD §5.11): cada jogatina é uma linha em
 * `lfg_sessions` e uma mensagem do bot no canal da agenda, com a lista e uma
 * thread. O banco é a verdade; a mensagem é redesenhada dele, coalescida, a
 * cada mudança na lista.
 */
export class SquadAgendaService {
  private readonly client: Client;
  private readonly db: Db;
  private readonly config: SquadAgendaDeps['config'];
  private readonly audit: Pick<AuditService, 'record'>;
  private readonly onChange: (guildId: string) => void;
  private readonly now: () => number;
  private readonly renderMs: number;
  private readonly drafts = new DraftBook();
  private readonly renders = new Map<string, NodeJS.Timeout>();

  constructor(deps: SquadAgendaDeps) {
    this.client = deps.client;
    this.db = deps.db;
    this.config = deps.config;
    this.audit = deps.audit;
    this.onChange = deps.onChange;
    this.now = deps.now ?? Date.now;
    this.renderMs = deps.renderMs ?? AGENDA_RENDER_MS;
  }

  stop(): void {
    for (const timer of this.renders.values()) clearTimeout(timer);
    this.renders.clear();
  }

  /** O canal da agenda, com tudo o que o bot precisa nele. A falta vira erro que ensina. */
  private agendaChannel(guild: Guild, config: SquadsConfig): TextChannel {
    const channel = config.agendaChannelId
      ? guild.channels.cache.get(config.agendaChannelId)
      : undefined;
    if (channel?.type !== ChannelType.GuildText) {
      throw new UserFacingError(
        'A agenda de jogatinas não tem canal configurado. Peça à staff para escolher um no painel.',
        { code: 'SQUADS_NO_AGENDA_CHANNEL' },
      );
    }
    const me = guild.members.me;
    const permissions = me ? channel.permissionsFor(me) : null;
    const missing = AGENDA_PERMISSIONS.filter(([, flag]) => !permissions?.has(flag)).map(
      ([name]) => name,
    );
    if (missing.length > 0) {
      throw new UserFacingError(
        `Para marcar jogatina em ${channel.toString()} me falta: **${missing.join('**, **')}**.`,
        { code: 'MISSING_PERMISSIONS' },
      );
    }
    return channel;
  }

  private async assertRoom(guildId: string, hostId: string): Promise<void> {
    const open = await countOpenLfgSessions(this.db, guildId, hostId);
    if (open.host >= LFG_MAX_SESSIONS_PER_HOST) {
      throw new UserFacingError(
        `Você já tem ${String(LFG_MAX_SESSIONS_PER_HOST)} jogatinas marcadas. ` +
          'Espere uma acontecer ou cancele alguma.',
        { code: 'LFG_TOO_MANY_FOR_HOST' },
      );
    }
    if (open.guild >= LFG_MAX_OPEN_SESSIONS) {
      throw new UserFacingError(
        `A agenda já tem ${String(LFG_MAX_OPEN_SESSIONS)} jogatinas marcadas. ` +
          'Espere uma acontecer ou peça à staff para cancelar alguma.',
        { code: 'LFG_TOO_MANY_SESSIONS' },
      );
    }
  }

  /**
   * O modal preenchido: confere tudo o que dá para conferir antes do clique em
   * ABERTA ou FECHADA e guarda o rascunho. Quem chama já validou o formato com
   * o schema de `shared`; o "quando" é lido aqui, no fuso da guild.
   */
  async prepare(
    member: GuildMember,
    input: { when: string; slots: number | undefined; note: string | null },
    config: SquadsConfig,
  ): Promise<ScheduleDraft> {
    const guild = member.guild;
    this.agendaChannel(guild, config);
    await this.assertRoom(guild.id, member.id);
    const { timezone } = await this.config.getSettings(guild.id);
    const draft: ScheduleDraft = {
      startsAt: parseWhen(input.when, new Date(this.now()), timezone),
      slots: input.slots ?? config.roomSize,
      note: input.note,
    };
    this.drafts.put(guild.id, member.id, draft, this.now());
    return draft;
  }

  /**
   * ABERTA ou FECHADA: cria a linha, posta a mensagem e abre a thread. A linha
   * nasce antes da mensagem porque os botões levam o id dela; mensagem que não
   * sai cancela a linha, para a agenda não guardar jogatina que ninguém vê.
   */
  async schedule(
    member: GuildMember,
    visibility: LfgVisibility,
    config: SquadsConfig,
    source: AuditSource,
  ): Promise<ScheduledSession> {
    const guild = member.guild;
    const draft = this.drafts.take(guild.id, member.id, this.now());
    if (!draft) {
      throw new UserFacingError('Esse formulário expirou. Clique em MARCAR JOGATINA de novo.', {
        code: 'LFG_DRAFT_GONE',
      });
    }
    if (draft.startsAt.getTime() <= this.now()) {
      throw new UserFacingError('Essa hora já passou. Clique em MARCAR JOGATINA de novo.', {
        code: 'LFG_WHEN_PAST',
      });
    }
    const channel = this.agendaChannel(guild, config);
    await this.assertRoom(guild.id, member.id);

    const { session, roster } = await createLfgSession(this.db, {
      guildId: guild.id,
      hostId: member.id,
      startsAt: draft.startsAt,
      slots: draft.slots,
      visibility,
      note: draft.note,
    });
    const settings = await this.config.getSettings(guild.id);

    let message;
    try {
      message = await channel.send(agendaMessage(session, roster, settings.embedColor));
    } catch (error) {
      await updateLfgSession(this.db, guild.id, session.id, { status: 'cancelled' });
      if (isMissingAccess(error)) {
        throw new UserFacingError(`Não tenho permissão para escrever em ${channel.toString()}.`, {
          code: 'MISSING_PERMISSIONS',
          cause: error,
        });
      }
      throw error;
    }

    let threadId: string | null = null;
    try {
      const thread = await message.startThread({
        name: threadName(draft.startsAt, settings.timezone),
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
        reason: `Jogatina marcada por ${member.user.username}`,
      });
      threadId = thread.id;
      await thread.members.add(member.id).catch(() => undefined);
    } catch (error) {
      // Sem thread a jogatina funciona; o lembrete e o link da sala vão para o log.
      log.warn({ err: error, guildId: guild.id, sessionId: session.id }, 'não abri a thread');
    }

    await updateLfgSession(this.db, guild.id, session.id, {
      channelId: channel.id,
      messageId: message.id,
      threadId,
    });

    this.audit.record({
      guildId: guild.id,
      action: 'squad.session.create',
      source,
      actor: member.id,
      target: { type: 'lfg_session', id: session.id },
      after: {
        startsAt: draft.startsAt.toISOString(),
        slots: draft.slots,
        visibility,
        messageId: message.id,
      },
    });
    this.onChange(guild.id);
    return {
      sessionId: session.id,
      startsAt: draft.startsAt,
      url: messageLink(guild.id, channel.id, message.id),
    };
  }

  /** VOU, ENTRAR NA ESPERA ou PEDIR VAGA: o botão é um só, a lista decide. */
  async join(member: GuildMember, sessionId: string): Promise<JoinOutcome> {
    const guild = member.guild;
    const { session, change } = await mutateLfgRoster(this.db, guild.id, sessionId, (roster) =>
      joinRoster(roster, member.id, this.now()),
    );
    this.render(guild.id, sessionId);
    if (change.outcome === 'requested') await this.notifyRequest(guild, session, member.id);
    return change.outcome;
  }

  /** SAIR: da lista, da fila ou do pedido. Vaga que abre puxa a fila, com DM. */
  async leave(member: GuildMember, sessionId: string): Promise<Exclude<LfgMemberStatus, 'host'>> {
    const guild = member.guild;
    const { session, change } = await mutateLfgRoster(this.db, guild.id, sessionId, (roster) =>
      leaveRoster(roster, member.id),
    );
    this.render(guild.id, sessionId);
    await this.grantRoom(guild, session, change.seated);
    await this.notifySeated(guild, session, change.seated);
    // `leaveRoster` recusa o host, então sobra só quem não é host.
    return change.outcome as Exclude<LfgMemberStatus, 'host'>;
  }

  /**
   * ACEITAR ou RECUSAR um pedido. Quem pode responder (o host, ou a staff na
   * thread) é conferido por quem chama, porque só ele sabe de onde veio o clique.
   */
  async answer(
    guild: Guild,
    sessionId: string,
    userId: string,
    accept: boolean,
    actorId: string,
  ): Promise<RequestAnswerResult> {
    const { session, change } = await mutateLfgRoster(this.db, guild.id, sessionId, (roster) =>
      accept ? acceptRequest(roster, userId) : rejectRequest(roster, userId),
    );
    this.render(guild.id, sessionId);
    this.audit.record({
      guildId: guild.id,
      action: accept ? 'squad.session.accept' : 'squad.session.reject',
      source: 'event',
      actor: actorId,
      target: { type: 'lfg_session', id: sessionId },
      after: { userId, outcome: change.outcome },
    });
    if (change.outcome === 'going') await this.grantRoom(guild, session, [userId]);
    const link = this.linkOf(session);
    const which = `jogatina de <t:${unix(session.startsAt)}:F> em **${guild.name}**`;
    const text =
      change.outcome === 'going'
        ? `Seu pedido foi aceito: você está na lista da ${which}.`
        : change.outcome === 'waiting'
          ? `Seu pedido foi aceito, mas lotou: você está na lista de espera da ${which}.`
          : `Dessa vez não rolou: quem marcou a ${which} recusou seu pedido.`;
    await this.dm(guild, userId, link ? `${text}\n${link}` : text);
    return { outcome: change.outcome, userId };
  }

  /** Quem marcou a jogatina, ou `null` quando ela já acabou, foi cancelada ou não é desta guild. */
  async hostOf(guildId: string, sessionId: string): Promise<string | null> {
    const found = await getLfgSession(this.db, guildId, sessionId);
    if (!found || (found.session.status !== 'scheduled' && found.session.status !== 'live')) {
      return null;
    }
    return found.session.hostId;
  }

  /** As próximas jogatinas com mensagem no ar, para o painel do buscar squad. */
  async upcoming(guildId: string, limit: number): Promise<AgendaSummary[]> {
    const sessions = await listUpcomingLfgSessions(this.db, guildId, limit);
    return sessions.flatMap((session) => {
      const url = this.linkOf(session);
      return url
        ? [{ id: session.id, hostId: session.hostId, startsAt: session.startsAt.getTime(), url }]
        : [];
    });
  }

  private linkOf(session: LfgSession): string | null {
    return session.channelId && session.messageId
      ? messageLink(session.guildId, session.channelId, session.messageId)
      : null;
  }

  /** Pede o redesenho da mensagem. Várias mudanças no intervalo viram uma edição. */
  render(guildId: string, sessionId: string): void {
    if (this.renders.has(sessionId)) return;
    const timer = setTimeout(() => {
      this.renders.delete(sessionId);
      void this.refresh(guildId, sessionId);
    }, this.renderMs);
    timer.unref();
    this.renders.set(sessionId, timer);
  }

  /** Redesenha a mensagem a partir do banco. Nunca lança: falha só vai para o log. */
  async refresh(guildId: string, sessionId: string): Promise<void> {
    try {
      const found = await getLfgSession(this.db, guildId, sessionId);
      if (!found?.session.channelId || !found.session.messageId) return;
      const guild = this.client.guilds.cache.get(guildId);
      const channel = guild?.channels.cache.get(found.session.channelId);
      if (channel?.type !== ChannelType.GuildText) return;
      const settings = await this.config.getSettings(guildId);
      await channel.messages.edit(
        found.session.messageId,
        agendaMessage(found.session, found.roster, settings.embedColor),
      );
    } catch (error) {
      log.debug({ err: error, guildId, sessionId }, 'mensagem da jogatina não atualizada');
    }
  }

  /**
   * O pedido vai por DM ao host. DM fechada cai num ping na thread, com os
   * mesmos botões; sem thread, só o log, e o pedido espera na lista.
   */
  private async notifyRequest(guild: Guild, session: LfgSession, userId: string): Promise<void> {
    const body = requestMessage(guild, session, userId, this.linkOf(session));
    try {
      const host = await guild.members.fetch(session.hostId);
      await host.send(body);
      return;
    } catch (error) {
      log.debug({ err: error, guildId: guild.id, sessionId: session.id }, 'DM do pedido recusada');
    }
    const thread = session.threadId ? guild.channels.cache.get(session.threadId) : undefined;
    if (!thread?.isThread()) {
      log.info({ guildId: guild.id, sessionId: session.id }, 'pedido de vaga sem DM nem thread');
      return;
    }
    try {
      await thread.send({
        content: `<@${session.hostId}>, chegou um pedido de vaga.`,
        ...body,
        allowedMentions: { users: [session.hostId] },
      });
    } catch (error) {
      log.warn({ err: error, guildId: guild.id, sessionId: session.id }, 'pedido de vaga perdido');
    }
  }

  /**
   * Quem ganha vaga numa fechada que já está rolando precisa do `Connect` na
   * sala, que nasceu liberada só para a lista do início. Aberta não tem o que
   * liberar. Falha vai para o log: a pessoa ainda pode pedir à staff.
   */
  private async grantRoom(guild: Guild, session: LfgSession, userIds: string[]): Promise<void> {
    if (session.status !== 'live' || session.visibility !== 'closed' || !session.roomId) return;
    const room = guild.channels.cache.get(session.roomId);
    if (room?.type !== ChannelType.GuildVoice) return;
    for (const userId of userIds) {
      try {
        await room.permissionOverwrites.edit(
          userId,
          { Connect: true },
          { reason: 'Vaga na jogatina' },
        );
      } catch (error) {
        log.warn({ err: error, guildId: guild.id, sessionId: session.id }, 'não liberei a sala');
      }
    }
  }

  private async notifySeated(guild: Guild, session: LfgSession, userIds: string[]): Promise<void> {
    const link = this.linkOf(session);
    for (const userId of userIds) {
      const text =
        `Abriu vaga na jogatina de <t:${unix(session.startsAt)}:F> em **${guild.name}**, ` +
        'e você saiu da lista de espera: está dentro.';
      await this.dm(guild, userId, link ? `${text}\n${link}` : text);
    }
  }

  /** DM de aviso. Fechada não é erro: a lista na mensagem continua certa. */
  private async dm(guild: Guild, userId: string, text: string): Promise<void> {
    try {
      const member = await guild.members.fetch(userId);
      await member.send({ embeds: [infoEmbed({ title: 'Jogatina', description: text })] });
    } catch (error) {
      log.debug({ err: error, guildId: guild.id, userId }, 'DM da jogatina recusada');
    }
  }
}
