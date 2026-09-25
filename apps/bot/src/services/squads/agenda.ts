import {
  countOpenLfgSessions,
  createLfgSession,
  getLfgSession,
  listMemberLfgSessions,
  mutateLfgRoster,
  updateLfgSession,
} from '@goodbot/db';
import {
  acceptRequest,
  joinRoster,
  kickFromRoster,
  LFG_MAX_OPEN_SESSIONS,
  LFG_MAX_SESSIONS_PER_HOST,
  leaveRoster,
  parseWhen,
  rejectRequest,
  requestedEntries,
  SECOND_MS,
  seatedEntries,
  setRosterSlots,
  setRosterVisibility,
  toLocalDateTime,
  UserFacingError,
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
import type { Db, LfgSession, LfgSessionWithRoster } from '@goodbot/db';
import type {
  AuditSource,
  JoinOutcome,
  LfgMemberStatus,
  LfgVisibility,
  Roster,
  RosterChange,
  SquadsConfig,
} from '@goodbot/shared';
import type { Client, Guild, GuildMember, TextChannel } from 'discord.js';

const log = childLogger('squads');

/** Uma edição por jogatina a cada tanto: uma rajada de VOU vira uma edição só. */
export const AGENDA_RENDER_MS = 1.5 * SECOND_MS;
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

/** O pedaço da jogatina que a mensagem mostra. */
export type AgendaSession = Pick<LfgSession, 'id' | 'hostId' | 'startsAt' | 'note' | 'status'>;

export function messageLink(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function unix(at: Date): string {
  return String(Math.floor(at.getTime() / 1000));
}

/** A linha de menções acima do aviso, ou nada quando não há quem marcar. */
function mentionLine(userIds: readonly string[]): string {
  return userIds.length > 0 ? `${userIds.map((id) => `<@${id}>`).join(' ')}\n` : '';
}

/** `<@a>\n<@b>`, cortando em `LIST_SHOWN` para o campo não passar de 1024. */
export function mentionList(userIds: readonly string[]): string {
  const shown = userIds.slice(0, LIST_SHOWN).map((id) => `<@${id}>`);
  const rest = userIds.length - shown.length;
  return rest > 0 ? `${shown.join('\n')}\ne mais ${String(rest)}` : shown.join('\n');
}

/** O texto do botão de entrar, conforme a jogatina está. Lotada, o clique ouve "lotou". */
export function joinLabel(roster: Roster): string {
  return roster.visibility === 'closed' ? 'PEDIR VAGA' : 'VOU';
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
          ? 'Aberta: quem clica em VOU entra na hora, enquanto houver vaga.'
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
  // Rolando, a jogatina é do relógio: remarcar, fechar ou cancelar não cabe mais.
  if (session.status === 'scheduled') {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(agendaId('manage', session.id))
        .setLabel('GERENCIAR')
        .setStyle(ButtonStyle.Secondary),
    );
  }
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
  requested: 'Pedido enviado. Quem marcou decide, e eu te aviso da resposta por DM.',
};

/**
 * O aviso por DM de quem teve o pedido respondido: pelo host, ou por ABRIR
 * (`refused` é o pedido que ficou sem vaga quando a jogatina abriu).
 */
function answeredText(outcome: 'going' | 'rejected' | 'refused', which: string): string {
  switch (outcome) {
    case 'going':
      return `Seu pedido foi aceito: você está na lista da ${which}.`;
    case 'rejected':
      return `Dessa vez não rolou: quem marcou a ${which} recusou seu pedido.`;
    case 'refused':
      return `A ${which} abriu, mas lotou antes de chegar no seu pedido. Tente de novo se abrir vaga.`;
  }
}

/** `16/09 21:00`, no fuso da guild: o REMARCAR já abre com a hora atual, num formato que `parseWhen` lê. */
export function whenDefault(startsAt: Date, timeZone: string): string {
  const local = toLocalDateTime(startsAt, timeZone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(local.day)}/${pad(local.month)} ${pad(local.hour)}:${pad(local.minute)}`;
}

export const LEAVE_TEXT: Record<Exclude<LfgMemberStatus, 'host'>, string> = {
  going: 'Pronto: você saiu da lista.',
  requested: 'Pronto: seu pedido foi retirado.',
  invited: 'Pronto: você recusou o convite.',
};

// ── O service ───────────────────────────────────────────────────────────────

export interface ScheduledSession {
  sessionId: string;
  startsAt: Date;
  url: string;
}

/** Uma jogatina de `/squad agenda`: onde a pessoa está nela. */
export interface MemberAgendaEntry {
  sessionId: string;
  startsAt: Date;
  status: LfgMemberStatus;
  url: string | null;
}

export interface RequestAnswerResult {
  outcome: 'going' | 'rejected';
  userId: string;
}

export interface SquadAgendaDeps {
  client: Client;
  db: Db;
  config: Pick<ConfigService, 'get' | 'getSettings'>;
  audit: Pick<AuditService, 'record'>;
  now?: () => number;
  renderMs?: number;
}

function startedError(): UserFacingError {
  return new UserFacingError(
    'A jogatina já começou: agora ela fecha sozinha quando a sala esvaziar.',
    { code: 'LFG_SESSION_STARTED' },
  );
}

function closedError(): UserFacingError {
  return new UserFacingError('Essa jogatina já acabou ou foi cancelada.', {
    code: 'LFG_SESSION_CLOSED',
  });
}

/** Regra de lista que só vale antes do início: o GERENCIAR. */
function beforeStart<O>(
  rule: (roster: Roster) => RosterChange<O>,
): (roster: Roster, session: LfgSession) => RosterChange<O> {
  return (roster, session) => {
    if (session.status !== 'scheduled') throw startedError();
    return rule(roster);
  };
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
  private readonly now: () => number;
  private readonly renderMs: number;
  private readonly renders = new Map<string, NodeJS.Timeout>();

  constructor(deps: SquadAgendaDeps) {
    this.client = deps.client;
    this.db = deps.db;
    this.config = deps.config;
    this.audit = deps.audit;
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
   * O modal do MARCAR JOGATINA: lê o "quando" no fuso da guild, cria a linha,
   * posta a mensagem e abre a thread. A jogatina nasce privada (PRD §5.11):
   * abrir é um clique no GERENCIAR. A linha nasce antes da mensagem porque os
   * botões levam o id dela; mensagem que não sai cancela a linha, para a
   * agenda não guardar jogatina que ninguém vê. Quem chama já validou o
   * formato com o schema de `shared`.
   */
  async schedule(
    member: GuildMember,
    input: { when: string; slots: number | undefined; note: string | null },
    config: SquadsConfig,
    source: AuditSource,
  ): Promise<ScheduledSession> {
    const guild = member.guild;
    const channel = this.agendaChannel(guild, config);
    await this.assertRoom(guild.id, member.id);
    const settings = await this.config.getSettings(guild.id);
    const startsAt = parseWhen(input.when, new Date(this.now()), settings.timezone);
    const slots = input.slots ?? config.roomSize;
    const visibility: LfgVisibility = 'closed';

    const { session, roster } = await createLfgSession(this.db, {
      guildId: guild.id,
      hostId: member.id,
      kind: 'scheduled',
      startsAt,
      slots,
      visibility,
      note: input.note,
    });

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
        name: threadName(startsAt, settings.timezone),
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
      after: { startsAt: startsAt.toISOString(), slots, visibility, messageId: message.id },
    });
    return {
      sessionId: session.id,
      startsAt,
      url: messageLink(guild.id, channel.id, message.id),
    };
  }

  /** VOU ou PEDIR VAGA: o botão é um só, a lista decide. Lotada, recusa com "lotou". */
  async join(member: GuildMember, sessionId: string): Promise<JoinOutcome> {
    const guild = member.guild;
    const { session, change } = await mutateLfgRoster(this.db, guild.id, sessionId, (roster) =>
      joinRoster(roster, member.id, this.now()),
    );
    this.render(guild.id, sessionId);
    if (change.outcome === 'requested') await this.notifyRequest(guild, session, member.id);
    return change.outcome;
  }

  /** SAIR: da lista, do pedido ou do convite. A vaga fica livre para quem clicar. */
  async leave(member: GuildMember, sessionId: string): Promise<Exclude<LfgMemberStatus, 'host'>> {
    const guild = member.guild;
    const { change } = await mutateLfgRoster(this.db, guild.id, sessionId, (roster) =>
      leaveRoster(roster, member.id),
    );
    this.render(guild.id, sessionId);
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
    const text = answeredText(change.outcome, which);
    await this.dm(guild, userId, link ? `${text}\n${link}` : text);
    return { outcome: change.outcome, userId };
  }

  // ── GERENCIAR ──────────────────────────────────────────────────────────────
  // Quem pode (o host ou a staff `mod`+) é conferido por quem chama, a cada
  // clique. Tudo aqui só vale antes do início.

  /** A jogatina com a lista, para o painel do GERENCIAR. Começada ou fechada é erro. */
  async manageable(guildId: string, sessionId: string): Promise<LfgSessionWithRoster> {
    const found = await getLfgSession(this.db, guildId, sessionId);
    if (!found) throw closedError();
    if (found.session.status === 'live') throw startedError();
    if (found.session.status !== 'scheduled') throw closedError();
    return found;
  }

  /**
   * REMARCAR: hora e nota novas. O lembrete volta a valer para a hora nova, e
   * a thread recebe o aviso marcando quem vai.
   */
  async reschedule(
    guild: Guild,
    sessionId: string,
    input: { when: string; note: string | null },
    actorId: string,
  ): Promise<LfgSession> {
    const before = await this.manageable(guild.id, sessionId);
    const previous = { startsAt: before.session.startsAt, note: before.session.note };
    const settings = await this.config.getSettings(guild.id);
    const startsAt = parseWhen(input.when, new Date(this.now()), settings.timezone);
    const session = await updateLfgSession(
      this.db,
      guild.id,
      sessionId,
      { startsAt, note: input.note, remindedAt: null },
      ['scheduled'],
    );
    if (!session) throw startedError();

    const thread = this.threadOf(guild, session);
    if (thread && startsAt.getTime() !== previous.startsAt.getTime()) {
      // Renomear thread tem rate limit apertado; o nome velho não quebra nada.
      await thread
        .setName(threadName(startsAt, settings.timezone))
        .catch((error: unknown) =>
          log.debug({ err: error, guildId: guild.id, sessionId }, 'thread não renomeada'),
        );
    }
    const others = seatedEntries(before.roster)
      .map((entry) => entry.userId)
      .filter((userId) => userId !== actorId);
    const at = unix(startsAt);
    await this.postInThread(
      guild,
      session,
      `${mentionLine(others)}Jogatina remarcada por <@${actorId}> para <t:${at}:F> (<t:${at}:R>).`,
      others,
    );

    this.audit.record({
      guildId: guild.id,
      action: 'squad.session.reschedule',
      source: 'event',
      actor: actorId,
      target: { type: 'lfg_session', id: sessionId },
      before: { startsAt: previous.startsAt.toISOString(), note: previous.note },
      after: { startsAt: startsAt.toISOString(), note: input.note },
    });
    this.render(guild.id, sessionId);
    return session;
  }

  /** VAGAS: baixar abaixo de quem já tem vaga é recusado. */
  async setSlots(guild: Guild, sessionId: string, slots: number, actorId: string): Promise<void> {
    await mutateLfgRoster(
      this.db,
      guild.id,
      sessionId,
      beforeStart((roster) => setRosterSlots(roster, slots)),
    );
    this.render(guild.id, sessionId);
    this.audit.record({
      guildId: guild.id,
      action: 'squad.session.slots',
      source: 'event',
      actor: actorId,
      target: { type: 'lfg_session', id: sessionId },
      after: { slots },
    });
  }

  /**
   * ABRIR ou FECHAR. Abrir aceita os pedidos pendentes na ordem em que
   * chegaram: com vaga sentam, sem vaga são recusados. Todos ouvem por DM.
   */
  async toggleVisibility(
    guild: Guild,
    sessionId: string,
    actorId: string,
  ): Promise<{ visibility: LfgVisibility; accepted: number; refused: number }> {
    const { session, change } = await mutateLfgRoster(
      this.db,
      guild.id,
      sessionId,
      beforeStart((roster) =>
        setRosterVisibility(roster, roster.visibility === 'open' ? 'closed' : 'open'),
      ),
    );
    this.render(guild.id, sessionId);
    this.audit.record({
      guildId: guild.id,
      action: 'squad.session.visibility',
      source: 'event',
      actor: actorId,
      target: { type: 'lfg_session', id: sessionId },
      after: { visibility: change.outcome, seated: change.seated, refused: change.refused },
    });
    const link = this.linkOf(session);
    const which = `jogatina de <t:${unix(session.startsAt)}:F> em **${guild.name}**`;
    for (const [outcome, userIds] of [
      ['going', change.seated],
      ['refused', change.refused],
    ] as const) {
      for (const userId of userIds) {
        const text = answeredText(outcome, which);
        await this.dm(guild, userId, link ? `${text}\n${link}` : text);
      }
    }
    return {
      visibility: change.outcome,
      accepted: change.seated.length,
      refused: change.refused.length,
    };
  }

  /** TIRAR ALGUÉM: da lista, dos pedidos ou dos convites. */
  async kick(guild: Guild, sessionId: string, userId: string, actorId: string) {
    const { session, change } = await mutateLfgRoster(
      this.db,
      guild.id,
      sessionId,
      beforeStart((roster) => kickFromRoster(roster, userId)),
    );
    this.render(guild.id, sessionId);
    this.audit.record({
      guildId: guild.id,
      action: 'squad.session.kick',
      source: 'event',
      actor: actorId,
      target: { type: 'lfg_session', id: sessionId },
      after: { userId, was: change.outcome },
    });
    await this.dm(
      guild,
      userId,
      `Quem organiza a jogatina de <t:${unix(session.startsAt)}:F> em **${guild.name}** ` +
        'tirou você da lista.',
    );
    return change.outcome;
  }

  /** CANCELAR: a mensagem fecha sem botões e a thread avisa quem ia. */
  async cancel(guild: Guild, sessionId: string, actorId: string): Promise<void> {
    const before = await this.manageable(guild.id, sessionId);
    const session = await updateLfgSession(
      this.db,
      guild.id,
      sessionId,
      { status: 'cancelled', endedAt: new Date(this.now()) },
      ['scheduled'],
    );
    if (!session) throw startedError();
    const others = before.roster.entries
      .map((entry) => entry.userId)
      .filter((userId) => userId !== actorId);
    await this.postInThread(
      guild,
      before.session,
      `${mentionLine(others)}A jogatina de <t:${unix(session.startsAt)}:F> foi cancelada ` +
        `por <@${actorId}>.`,
      others,
    );
    this.audit.record({
      guildId: guild.id,
      action: 'squad.session.cancel',
      source: 'event',
      actor: actorId,
      target: { type: 'lfg_session', id: sessionId },
      before: { startsAt: session.startsAt.toISOString(), members: before.roster.entries.length },
    });
    await this.refresh(guild.id, sessionId);
  }

  /** As jogatinas abertas em que a pessoa está, da mais próxima para a mais distante. */
  async mine(guildId: string, userId: string, limit: number): Promise<MemberAgendaEntry[]> {
    const rows = await listMemberLfgSessions(this.db, guildId, userId, limit);
    return rows.map(({ session, status }) => ({
      sessionId: session.id,
      startsAt: session.startsAt,
      status,
      url: this.linkOf(session),
    }));
  }

  /** Quem marcou a jogatina, ou `null` quando ela já acabou, foi cancelada ou não é desta guild. */
  async hostOf(guildId: string, sessionId: string): Promise<string | null> {
    const found = await getLfgSession(this.db, guildId, sessionId);
    if (!found || (found.session.status !== 'scheduled' && found.session.status !== 'live')) {
      return null;
    }
    return found.session.hostId;
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

  private threadOf(guild: Guild, session: LfgSession) {
    const thread = session.threadId ? guild.channels.cache.get(session.threadId) : undefined;
    return thread?.isThread() ? thread : null;
  }

  /** Aviso na thread da jogatina. Sem thread, ou falhando, só o log. */
  private async postInThread(
    guild: Guild,
    session: LfgSession,
    content: string,
    users: readonly string[],
  ): Promise<void> {
    const thread = this.threadOf(guild, session);
    if (!thread) {
      log.info({ guildId: guild.id, sessionId: session.id }, 'jogatina sem thread; aviso perdido');
      return;
    }
    try {
      await thread.send({ content, allowedMentions: { users: [...users] } });
    } catch (error) {
      log.warn({ err: error, guildId: guild.id, sessionId: session.id }, 'aviso na thread falhou');
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
    const thread = this.threadOf(guild, session);
    if (!thread) {
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
