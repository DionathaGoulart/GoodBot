import {
  AdminDiagnosticsSchema,
  AdminGuildListSchema,
  BroadcastInputSchema,
  BroadcastResultSchema,
  LeaveGuildInputSchema,
  LeaveGuildResultSchema,
  MaintenanceInputSchema,
  MaintenanceStateSchema,
  ResyncCommandsInputSchema,
  ResyncCommandsResultSchema,
} from './admin';
import { RaidModeInputSchema, RaidModeStateSchema } from './automod';
import { BotProfileInputSchema, BotProfileSchema } from './bot-profile';
import { CaseDeleteInputSchema, CaseEditInputSchema, CaseSummarySchema } from './cases';
import {
  ChannelCreateInputSchema,
  ChannelOverridesInputSchema,
  ChannelUpdateInputSchema,
  GuildChannelDetailSchema,
  GuildStateSchema,
  SlowmodeInputSchema,
} from './channels';
import { CommandSummarySchema } from './commands';
import { ApiErrorSchema, ApiOkSchema } from './common';
import { InvalidateInputSchema } from './config';
import {
  GuildScheduledEventListSchema,
  GuildScheduledEventSummarySchema,
  ScheduledEventInputSchema,
} from './events';
import {
  EmojiCreateInputSchema,
  EmojiUpdateInputSchema,
  ExpressionOverviewSchema,
  GuildEmojiSummarySchema,
  GuildStickerSummarySchema,
  StickerCreateInputSchema,
  StickerUpdateInputSchema,
} from './expressions';
import {
  BanListQuerySchema,
  GuildBanPageSchema,
  GuildProfileSchema,
  GuildSettingsInputSchema,
} from './guild';
import { HealthResponseSchema } from './health';
import {
  CreateInviteInputSchema,
  GuildInviteListSchema,
  GuildInviteSummarySchema,
} from './invites';
import {
  AuditLogEntrySummarySchema,
  AuditLogQuerySchema,
  GuildChannelSummarySchema,
  GuildMemberDetailSchema,
  GuildMemberSummarySchema,
  GuildRoleSummarySchema,
  MemberSearchQuerySchema,
} from './members';
import {
  ChannelMessageSummarySchema,
  DeleteMessageInputSchema,
  MessageHistoryQuerySchema,
  PublishPanelInputSchema,
  SendMessageInputSchema,
  SendMessageResultSchema,
} from './messages';
import { ModerationActionInputSchema, ModerationActionResultSchema } from './moderation';
import { InviteNoticeInputSchema, InviteNoticeResultSchema } from './registry';
import {
  ActorInputSchema,
  MemberRolesInputSchema,
  RoleMoveInputSchema,
  RoleWriteInputSchema,
} from './roles';
import {
  SocialAccountSummarySchema,
  SocialOverviewSchema,
  SocialResolveInputSchema,
  SocialResolveResultSchema,
  SocialTestResultSchema,
} from './social';
import {
  ArchiveSquadInputSchema,
  PostSquadSearchMessageInputSchema,
  PostSquadSearchMessageResultSchema,
  RenameSquadInputSchema,
  RunSquadMatchInputSchema,
  RunSquadMatchResultSchema,
  SquadOverviewSchema,
  SquadSummarySchema,
} from './squads';
import { CloseTicketInputSchema, CloseTicketResultSchema } from './tickets';
import { SocialAccountInputSchema } from '../config/social';

import type {
  AdminDiagnostics,
  AdminGuildList,
  BroadcastInput,
  BroadcastResult,
  LeaveGuildInput,
  LeaveGuildResult,
  MaintenanceInput,
  MaintenanceState,
  ResyncCommandsInput,
  ResyncCommandsResult,
} from './admin';
import type { RaidModeInput, RaidModeState } from './automod';
import type { BotProfile, BotProfileInput } from './bot-profile';
import type { CaseDeleteInput, CaseEditInput, CaseSummary } from './cases';
import type {
  ChannelCreateInput,
  ChannelOverridesInput,
  ChannelUpdateInput,
  GuildChannelDetail,
  GuildState,
  SlowmodeInput,
} from './channels';
import type { CommandSummary } from './commands';
import type { ApiError } from './common';
import type { InvalidateInput } from './config';
import type {
  GuildScheduledEventList,
  GuildScheduledEventSummary,
  ScheduledEventInput,
} from './events';
import type {
  EmojiCreateInput,
  EmojiUpdateInput,
  ExpressionOverview,
  GuildEmojiSummary,
  GuildStickerSummary,
  StickerCreateInput,
  StickerUpdateInput,
} from './expressions';
import type { BanListQuery, GuildBanPage, GuildProfile, GuildSettingsInput } from './guild';
import type { HealthResponse } from './health';
import type { CreateInviteInput, GuildInviteList, GuildInviteSummary } from './invites';
import type {
  AuditLogEntrySummary,
  AuditLogQuery,
  GuildChannelSummary,
  GuildMemberDetail,
  GuildMemberSummary,
  GuildRoleSummary,
  MemberSearchQuery,
} from './members';
import type {
  ChannelMessageSummary,
  DeleteMessageInput,
  MessageHistoryQuery,
  PublishPanelInput,
  SendMessageInput,
  SendMessageResult,
} from './messages';
import type { ModerationActionInput, ModerationActionResult } from './moderation';
import type { InviteNoticeInput, InviteNoticeResult } from './registry';
import type { ActorInput, MemberRolesInput, RoleMoveInput, RoleWriteInput } from './roles';
import type {
  SocialAccountSummary,
  SocialOverview,
  SocialResolveResult,
  SocialTestResult,
} from './social';
import type {
  ArchiveSquadInput,
  PostSquadSearchMessageInput,
  PostSquadSearchMessageResult,
  RenameSquadInput,
  RunSquadMatchInput,
  RunSquadMatchResult,
  SquadOverview,
  SquadSummary,
} from './squads';
import type { CloseTicketInput, CloseTicketResult } from './tickets';
import type { SocialAccountInput } from '../config/social';
import type { z } from 'zod';

/** Timeout padrão de uma chamada; a API do bot é local a um datacenter. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Timeout das rotas que varrem **todos** os servidores um a um (o broadcast e
 * o re-registro de comandos do painel admin).
 *
 * O padrão de 10 s vale para uma chamada ao Discord; estas fazem uma por
 * servidor, em série de propósito — disparar cem juntas passaria do limite
 * global do Discord, e a fila do discord.js resolveria isso enfileirando sem
 * ninguém saber onde parou. Com o teto de 100 servidores do produto, dois
 * minutos é folga confortável.
 *
 * Deixar em 10 s seria pior do que lento: o painel desistiria enquanto o bot
 * continuasse mandando, e o dono veria "não respondeu a tempo" numa ação que
 * está dando certo — e provavelmente clicaria de novo.
 */
export const SWEEP_TIMEOUT_MS = 120_000;

export interface InternalClientOptions {
  /** Sem barra no fim. Dev: `http://localhost:3001`. */
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  /** Injetável nos testes do painel. */
  fetch?: typeof globalThis.fetch;
}

/** Erro de qualquer chamada à API do bot — inclusive rede e timeout. */
export class InternalApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: NonNullable<ApiError['error']['issues']>;
  /** Segundos sugeridos para tentar de novo (`503` vindo de rate limit). */
  readonly retryAfter: number | null;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      issues?: ApiError['error']['issues'];
      retryAfter?: number | null;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'InternalApiError';
    this.status = options.status ?? 0;
    this.code = options.code ?? 'NETWORK';
    this.issues = options.issues ?? [];
    this.retryAfter = options.retryAfter ?? null;
  }
}

type Query = Record<string, string | number | undefined>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Query;
  body?: unknown;
  /** Sobrepõe o timeout do cliente numa chamada só. */
  timeoutMs?: number;
}

function buildUrl(baseUrl: string, path: string, query?: Query): string {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function toApiError(response: Response): Promise<InternalApiError> {
  const retryAfterHeader = response.headers.get('retry-after');
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : null;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const parsed = ApiErrorSchema.safeParse(body);
  if (parsed.success) {
    return new InternalApiError(parsed.data.error.message, {
      status: response.status,
      code: parsed.data.error.code,
      issues: parsed.data.error.issues,
      retryAfter: Number.isFinite(retryAfter) ? retryAfter : null,
    });
  }
  return new InternalApiError(`A API do bot respondeu ${response.status}.`, {
    status: response.status,
    code: 'UNKNOWN',
    retryAfter: Number.isFinite(retryAfter) ? retryAfter : null,
  });
}

/**
 * Client tipado da API interna do bot (PRD §5.7). Cada função valida a
 * resposta com o mesmo schema que o servidor usa, então um deploy dessincronizado
 * falha aqui e não no meio de um componente do painel.
 */
export function createInternalClient(options: InternalClientOptions) {
  const { baseUrl, token } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetch ?? globalThis.fetch;

  async function request<S extends z.ZodType>(
    schema: S,
    path: string,
    { method = 'GET', query, body, timeoutMs: override }: RequestOptions = {},
  ): Promise<z.infer<S>> {
    const signal = AbortSignal.timeout(override ?? timeoutMs);
    let response: Response;
    try {
      response = await doFetch(buildUrl(baseUrl, path, query), {
        method,
        signal,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new InternalApiError(
        timedOut ? 'A API do bot não respondeu a tempo.' : 'Não foi possível falar com o bot.',
        { code: timedOut ? 'TIMEOUT' : 'NETWORK', cause: error },
      );
    }

    if (!response.ok) throw await toApiError(response);

    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) {
      throw new InternalApiError('A API do bot devolveu um formato inesperado.', {
        status: response.status,
        code: 'BAD_RESPONSE',
        cause: parsed.error,
      });
    }
    return parsed.data;
  }

  const guild = (guildId: string) => `/guilds/${encodeURIComponent(guildId)}`;

  return {
    health: (): Promise<HealthResponse> => request(HealthResponseSchema, '/health'),

    /**
     * O painel do dono (`admin.<domínio>`). São as únicas rotas fora de
     * `/guilds`: o que as libera é o `actorId` ser o `OWNER_DISCORD_ID` do bot,
     * não o nível de alguém num servidor.
     */
    admin: {
      guilds: (): Promise<AdminGuildList> => request(AdminGuildListSchema, '/admin/guilds'),

      leaveGuild: (guildId: string, input: LeaveGuildInput): Promise<LeaveGuildResult> =>
        request(LeaveGuildResultSchema, `/admin/guilds/${encodeURIComponent(guildId)}/leave`, {
          method: 'POST',
          body: LeaveGuildInputSchema.parse(input),
        }),

      broadcast: (input: BroadcastInput): Promise<BroadcastResult> =>
        request(BroadcastResultSchema, '/admin/broadcast', {
          method: 'POST',
          body: BroadcastInputSchema.parse(input),
          timeoutMs: SWEEP_TIMEOUT_MS,
        }),

      maintenance: (): Promise<MaintenanceState> =>
        request(MaintenanceStateSchema, '/admin/maintenance'),

      setMaintenance: (input: MaintenanceInput): Promise<MaintenanceState> =>
        request(MaintenanceStateSchema, '/admin/maintenance', {
          method: 'POST',
          body: MaintenanceInputSchema.parse(input),
        }),

      resyncCommands: (input: ResyncCommandsInput): Promise<ResyncCommandsResult> =>
        request(ResyncCommandsResultSchema, '/admin/commands/resync', {
          method: 'POST',
          body: ResyncCommandsInputSchema.parse(input),
          timeoutMs: SWEEP_TIMEOUT_MS,
        }),

      diagnostics: (): Promise<AdminDiagnostics> =>
        request(AdminDiagnosticsSchema, '/admin/diagnostics'),
    },

    /**
     * O aviso por DM para quem convidou o bot. Também fora de `/guilds`, e
     * pela mesma razão do `/admin`: metade dos avisos é sobre servidor que o
     * bot não atende. Sem `actorId` — ver `api/registry.ts`.
     */
    inviteNotice: (guildId: string, input: InviteNoticeInput): Promise<InviteNoticeResult> =>
      request(InviteNoticeResultSchema, `/registry/${encodeURIComponent(guildId)}/notice`, {
        method: 'POST',
        body: InviteNoticeInputSchema.parse(input),
      }),

    /** Dados do servidor + o que o bot pode editar nele (PRD §6.3). */
    guildProfile: (guildId: string): Promise<GuildProfile> =>
      request(GuildProfileSchema, guild(guildId)),

    updateGuildProfile: (guildId: string, input: GuildSettingsInput): Promise<GuildProfile> =>
      request(GuildProfileSchema, guild(guildId), {
        method: 'PATCH',
        body: GuildSettingsInputSchema.parse(input),
      }),

    /**
     * O perfil do bot neste servidor (PRD §6.6). Não passa pelo banco: quem
     * guarda apelido, avatar e capa por servidor é o próprio Discord.
     */
    botProfile: (guildId: string): Promise<BotProfile> =>
      request(BotProfileSchema, `${guild(guildId)}/bot-profile`),

    updateBotProfile: (guildId: string, input: BotProfileInput): Promise<BotProfile> =>
      request(BotProfileSchema, `${guild(guildId)}/bot-profile`, {
        method: 'PATCH',
        body: BotProfileInputSchema.parse(input),
      }),

    bans: (guildId: string, query: Partial<BanListQuery> = {}): Promise<GuildBanPage> =>
      request(GuildBanPageSchema, `${guild(guildId)}/bans`, {
        query: BanListQuerySchema.parse(query),
      }),

    /** Desbanir passa pelo mesmo serviço do `/unban`; só o `source` muda. */
    unban: (guildId: string, userId: string, input: ActorInput): Promise<ModerationActionResult> =>
      request(
        ModerationActionResultSchema,
        `${guild(guildId)}/bans/${encodeURIComponent(userId)}`,
        { method: 'DELETE', body: ActorInputSchema.parse(input) },
      ),

    /** Convites do servidor (PRD §6.3); exige `ManageGuild` ao bot. */
    invites: (guildId: string): Promise<GuildInviteList> =>
      request(GuildInviteListSchema, `${guild(guildId)}/invites`),

    createInvite: (guildId: string, input: CreateInviteInput): Promise<GuildInviteSummary> =>
      request(GuildInviteSummarySchema, `${guild(guildId)}/invites`, {
        method: 'POST',
        body: CreateInviteInputSchema.parse(input),
      }),

    deleteInvite: (guildId: string, code: string, input: ActorInput): Promise<{ ok: true }> =>
      request(ApiOkSchema, `${guild(guildId)}/invites/${encodeURIComponent(code)}`, {
        method: 'DELETE',
        body: ActorInputSchema.parse(input),
      }),

    /** Eventos agendados. Lidos por REST: o cache do manager é 0 (PRD §7.2). */
    scheduledEvents: (guildId: string): Promise<GuildScheduledEventList> =>
      request(GuildScheduledEventListSchema, `${guild(guildId)}/events`),

    createScheduledEvent: (
      guildId: string,
      input: ScheduledEventInput,
    ): Promise<GuildScheduledEventSummary> =>
      request(GuildScheduledEventSummarySchema, `${guild(guildId)}/events`, {
        method: 'POST',
        body: ScheduledEventInputSchema.parse(input),
      }),

    updateScheduledEvent: (
      guildId: string,
      eventId: string,
      input: ScheduledEventInput,
    ): Promise<GuildScheduledEventSummary> =>
      request(
        GuildScheduledEventSummarySchema,
        `${guild(guildId)}/events/${encodeURIComponent(eventId)}`,
        { method: 'PATCH', body: ScheduledEventInputSchema.parse(input) },
      ),

    deleteScheduledEvent: (
      guildId: string,
      eventId: string,
      input: ActorInput,
    ): Promise<{ ok: true }> =>
      request(ApiOkSchema, `${guild(guildId)}/events/${encodeURIComponent(eventId)}`, {
        method: 'DELETE',
        body: ActorInputSchema.parse(input),
      }),

    /** Emojis e stickers + os slots que sobram no nível de impulso atual. */
    expressions: (guildId: string): Promise<ExpressionOverview> =>
      request(ExpressionOverviewSchema, `${guild(guildId)}/expressions`),

    createEmoji: (guildId: string, input: EmojiCreateInput): Promise<GuildEmojiSummary> =>
      request(GuildEmojiSummarySchema, `${guild(guildId)}/expressions/emojis`, {
        method: 'POST',
        body: EmojiCreateInputSchema.parse(input),
      }),

    updateEmoji: (
      guildId: string,
      emojiId: string,
      input: EmojiUpdateInput,
    ): Promise<GuildEmojiSummary> =>
      request(
        GuildEmojiSummarySchema,
        `${guild(guildId)}/expressions/emojis/${encodeURIComponent(emojiId)}`,
        { method: 'PATCH', body: EmojiUpdateInputSchema.parse(input) },
      ),

    deleteEmoji: (guildId: string, emojiId: string, input: ActorInput): Promise<{ ok: true }> =>
      request(ApiOkSchema, `${guild(guildId)}/expressions/emojis/${encodeURIComponent(emojiId)}`, {
        method: 'DELETE',
        body: ActorInputSchema.parse(input),
      }),

    createSticker: (guildId: string, input: StickerCreateInput): Promise<GuildStickerSummary> =>
      request(GuildStickerSummarySchema, `${guild(guildId)}/expressions/stickers`, {
        method: 'POST',
        body: StickerCreateInputSchema.parse(input),
      }),

    updateSticker: (
      guildId: string,
      stickerId: string,
      input: StickerUpdateInput,
    ): Promise<GuildStickerSummary> =>
      request(
        GuildStickerSummarySchema,
        `${guild(guildId)}/expressions/stickers/${encodeURIComponent(stickerId)}`,
        { method: 'PATCH', body: StickerUpdateInputSchema.parse(input) },
      ),

    deleteSticker: (guildId: string, stickerId: string, input: ActorInput): Promise<{ ok: true }> =>
      request(
        ApiOkSchema,
        `${guild(guildId)}/expressions/stickers/${encodeURIComponent(stickerId)}`,
        { method: 'DELETE', body: ActorInputSchema.parse(input) },
      ),

    channels: (guildId: string): Promise<GuildChannelSummary[]> =>
      request(GuildChannelSummarySchema.array(), `${guild(guildId)}/channels`),

    /**
     * O servidor inteiro numa resposta: cargos, canais e o detalhe de cada um.
     * Substitui o `2 + N` de `roles` + `channels` + um `channel` por canal, que
     * é o custo de montar o mesmo retrato de fora.
     */
    guildState: (guildId: string): Promise<GuildState> =>
      request(GuildStateSchema, `${guild(guildId)}/state`),

    /**
     * Cargos da guild. `counts` pede a contagem de membros por cargo, que
     * custa uma varredura no Discord — só a tela de cargos precisa dela
     * (ver `RoleListQuerySchema`). A checagem de permissão chama sem.
     */
    roles: (guildId: string, options: { counts?: boolean } = {}): Promise<GuildRoleSummary[]> =>
      request(
        GuildRoleSummarySchema.array(),
        `${guild(guildId)}/roles`,
        options.counts === true ? { query: { counts: '1' } } : {},
      ),

    members: (
      guildId: string,
      query: Partial<MemberSearchQuery> = {},
    ): Promise<GuildMemberSummary[]> =>
      request(GuildMemberSummarySchema.array(), `${guild(guildId)}/members`, {
        query: MemberSearchQuerySchema.parse(query),
      }),

    member: (guildId: string, userId: string): Promise<GuildMemberDetail> =>
      request(GuildMemberDetailSchema, `${guild(guildId)}/members/${encodeURIComponent(userId)}`),

    auditLog: (
      guildId: string,
      query: Partial<AuditLogQuery> = {},
    ): Promise<AuditLogEntrySummary[]> =>
      request(AuditLogEntrySummarySchema.array(), `${guild(guildId)}/audit-log`, {
        query: AuditLogQuerySchema.parse(query),
      }),

    channel: (guildId: string, channelId: string): Promise<GuildChannelDetail> =>
      request(
        GuildChannelDetailSchema,
        `${guild(guildId)}/channels/${encodeURIComponent(channelId)}`,
      ),

    createChannel: (guildId: string, input: ChannelCreateInput): Promise<GuildChannelDetail> =>
      request(GuildChannelDetailSchema, `${guild(guildId)}/channels`, {
        method: 'POST',
        body: ChannelCreateInputSchema.parse(input),
      }),

    updateChannel: (
      guildId: string,
      channelId: string,
      input: ChannelUpdateInput,
    ): Promise<GuildChannelDetail> =>
      request(
        GuildChannelDetailSchema,
        `${guild(guildId)}/channels/${encodeURIComponent(channelId)}`,
        {
          method: 'PATCH',
          body: ChannelUpdateInputSchema.parse(input),
        },
      ),

    deleteChannel: (guildId: string, channelId: string, input: ActorInput): Promise<{ ok: true }> =>
      request(ApiOkSchema, `${guild(guildId)}/channels/${encodeURIComponent(channelId)}`, {
        method: 'DELETE',
        body: ActorInputSchema.parse(input),
      }),

    setSlowmode: (
      guildId: string,
      channelId: string,
      input: SlowmodeInput,
    ): Promise<GuildChannelDetail> =>
      request(
        GuildChannelDetailSchema,
        `${guild(guildId)}/channels/${encodeURIComponent(channelId)}/slowmode`,
        { method: 'POST', body: SlowmodeInputSchema.parse(input) },
      ),

    /** `lock`/`unlock` mexem só no `SendMessages` do `@everyone` — igual ao comando. */
    lockChannel: (
      guildId: string,
      channelId: string,
      input: ActorInput,
    ): Promise<GuildChannelDetail> =>
      request(
        GuildChannelDetailSchema,
        `${guild(guildId)}/channels/${encodeURIComponent(channelId)}/lock`,
        { method: 'POST', body: ActorInputSchema.parse(input) },
      ),

    unlockChannel: (
      guildId: string,
      channelId: string,
      input: ActorInput,
    ): Promise<GuildChannelDetail> =>
      request(
        GuildChannelDetailSchema,
        `${guild(guildId)}/channels/${encodeURIComponent(channelId)}/unlock`,
        { method: 'POST', body: ActorInputSchema.parse(input) },
      ),

    setChannelOverrides: (
      guildId: string,
      channelId: string,
      input: ChannelOverridesInput,
    ): Promise<GuildChannelDetail> =>
      request(
        GuildChannelDetailSchema,
        `${guild(guildId)}/channels/${encodeURIComponent(channelId)}/overrides`,
        { method: 'POST', body: ChannelOverridesInputSchema.parse(input) },
      ),

    createRole: (guildId: string, input: RoleWriteInput): Promise<GuildRoleSummary> =>
      request(GuildRoleSummarySchema, `${guild(guildId)}/roles`, {
        method: 'POST',
        body: RoleWriteInputSchema.parse(input),
      }),

    updateRole: (
      guildId: string,
      roleId: string,
      input: RoleWriteInput,
    ): Promise<GuildRoleSummary> =>
      request(GuildRoleSummarySchema, `${guild(guildId)}/roles/${encodeURIComponent(roleId)}`, {
        method: 'PATCH',
        body: RoleWriteInputSchema.parse(input),
      }),

    deleteRole: (guildId: string, roleId: string, input: ActorInput): Promise<{ ok: true }> =>
      request(ApiOkSchema, `${guild(guildId)}/roles/${encodeURIComponent(roleId)}`, {
        method: 'DELETE',
        body: ActorInputSchema.parse(input),
      }),

    moveRole: (guildId: string, roleId: string, input: RoleMoveInput): Promise<GuildRoleSummary> =>
      request(
        GuildRoleSummarySchema,
        `${guild(guildId)}/roles/${encodeURIComponent(roleId)}/position`,
        { method: 'PATCH', body: RoleMoveInputSchema.parse(input) },
      ),

    setMemberRoles: (
      guildId: string,
      userId: string,
      input: MemberRolesInput,
    ): Promise<GuildMemberDetail> =>
      request(
        GuildMemberDetailSchema,
        `${guild(guildId)}/members/${encodeURIComponent(userId)}/roles`,
        { method: 'POST', body: MemberRolesInputSchema.parse(input) },
      ),

    /**
     * Edita o motivo de um caso. Passa pelo bot (e não por um update direto do
     * painel) porque a mensagem já publicada no mod-log precisa ser reeditada,
     * e só o bot fala com o Discord (PRD §6.4).
     */
    editCase: (guildId: string, caseNumber: number, input: CaseEditInput): Promise<CaseSummary> =>
      request(
        CaseSummarySchema,
        `${guild(guildId)}/cases/${encodeURIComponent(String(caseNumber))}`,
        {
          method: 'PATCH',
          body: CaseEditInputSchema.parse(input),
        },
      ),

    /** Soft delete do caso (só admin); a linha continua no banco. */
    deleteCase: (
      guildId: string,
      caseNumber: number,
      input: CaseDeleteInput,
    ): Promise<CaseSummary> =>
      request(
        CaseSummarySchema,
        `${guild(guildId)}/cases/${encodeURIComponent(String(caseNumber))}`,
        {
          method: 'DELETE',
          body: CaseDeleteInputSchema.parse(input),
        },
      ),

    moderate: (guildId: string, input: ModerationActionInput): Promise<ModerationActionResult> =>
      request(ModerationActionResultSchema, `${guild(guildId)}/moderation`, {
        method: 'POST',
        body: ModerationActionInputSchema.parse(input),
      }),

    /** Manifesto vivo dos comandos carregados pelo bot. */
    commands: (guildId: string): Promise<CommandSummary[]> =>
      request(CommandSummarySchema.array(), `${guild(guildId)}/commands`),

    raidMode: (guildId: string): Promise<RaidModeState> =>
      request(RaidModeStateSchema, `${guild(guildId)}/automod/raid`),

    setRaidMode: (guildId: string, input: RaidModeInput): Promise<RaidModeState> =>
      request(RaidModeStateSchema, `${guild(guildId)}/automod/raid`, {
        method: 'POST',
        body: RaidModeInputSchema.parse(input),
      }),

    closeTicket: (
      guildId: string,
      ticketId: number,
      input: CloseTicketInput,
    ): Promise<CloseTicketResult> =>
      request(
        CloseTicketResultSchema,
        `${guild(guildId)}/tickets/${encodeURIComponent(String(ticketId))}/close`,
        { method: 'POST', body: CloseTicketInputSchema.parse(input) },
      ),

    invalidateConfig: (guildId: string, input: InvalidateInput = {}): Promise<{ ok: true }> =>
      request(ApiOkSchema, `${guild(guildId)}/config/invalidate`, {
        method: 'POST',
        body: InvalidateInputSchema.parse(input),
      }),

    sendMessage: (guildId: string, input: SendMessageInput): Promise<SendMessageResult> =>
      request(SendMessageResultSchema, `${guild(guildId)}/messages`, {
        method: 'POST',
        body: SendMessageInputSchema.parse(input),
      }),

    /** Últimas mensagens de um canal, para o painel escolher o que editar. */
    channelMessages: (
      guildId: string,
      channelId: string,
      query: Partial<MessageHistoryQuery> = {},
    ): Promise<ChannelMessageSummary[]> =>
      request(
        ChannelMessageSummarySchema.array(),
        `${guild(guildId)}/channels/${encodeURIComponent(channelId)}/messages`,
        { query: MessageHistoryQuerySchema.parse(query) },
      ),

    /** Devolve o que foi apagado: é o que a auditoria do painel guarda. */
    deleteMessage: (
      guildId: string,
      channelId: string,
      messageId: string,
      input: DeleteMessageInput,
    ): Promise<ChannelMessageSummary> =>
      request(
        ChannelMessageSummarySchema,
        `${guild(guildId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
        { method: 'DELETE', body: DeleteMessageInputSchema.parse(input) },
      ),

    publishReactionRolePanel: (
      guildId: string,
      panelId: string,
      input: PublishPanelInput = {},
    ): Promise<SendMessageResult> =>
      request(
        SendMessageResultSchema,
        `${guild(guildId)}/reaction-roles/${encodeURIComponent(panelId)}/publish`,
        { method: 'POST', body: PublishPanelInputSchema.parse(input) },
      ),

    /** Apaga a mensagem publicada do painel; a linha continua no banco. */
    unpublishReactionRolePanel: (guildId: string, panelId: string): Promise<{ ok: true }> =>
      request(
        ApiOkSchema,
        `${guild(guildId)}/reaction-roles/${encodeURIComponent(panelId)}/unpublish`,
        { method: 'POST' },
      ),

    publishTicketPanel: (
      guildId: string,
      panelId: string,
      input: PublishPanelInput = {},
    ): Promise<SendMessageResult> =>
      request(
        SendMessageResultSchema,
        `${guild(guildId)}/tickets/panels/${encodeURIComponent(panelId)}/publish`,
        { method: 'POST', body: PublishPanelInputSchema.parse(input) },
      ),

    unpublishTicketPanel: (guildId: string, panelId: string): Promise<{ ok: true }> =>
      request(
        ApiOkSchema,
        `${guild(guildId)}/tickets/panels/${encodeURIComponent(panelId)}/unpublish`,
        { method: 'POST' },
      ),

    /** Contas observadas neste servidor (PRD §5.8). */
    social: (guildId: string): Promise<SocialOverview> =>
      request(SocialOverviewSchema, `${guild(guildId)}/social`),

    /**
     * URL, `@handle` ou `UC…` → o canal de verdade. O painel chama antes de
     * salvar: quem fala com o YouTube é o bot, não o Next.
     */
    resolveSocialChannel: (guildId: string, input: string): Promise<SocialResolveResult> =>
      request(SocialResolveResultSchema, `${guild(guildId)}/social/resolve`, {
        method: 'POST',
        body: SocialResolveInputSchema.parse({ input }),
      }),

    createSocialAccount: (
      guildId: string,
      input: SocialAccountInput,
    ): Promise<SocialAccountSummary> =>
      request(SocialAccountSummarySchema, `${guild(guildId)}/social`, {
        method: 'POST',
        body: SocialAccountInputSchema.parse(input),
      }),

    updateSocialAccount: (
      guildId: string,
      accountId: string,
      input: SocialAccountInput,
    ): Promise<SocialAccountSummary> =>
      request(
        SocialAccountSummarySchema,
        `${guild(guildId)}/social/${encodeURIComponent(accountId)}`,
        {
          method: 'PATCH',
          body: SocialAccountInputSchema.parse(input),
        },
      ),

    deleteSocialAccount: (guildId: string, accountId: string): Promise<{ ok: true }> =>
      request(ApiOkSchema, `${guild(guildId)}/social/${encodeURIComponent(accountId)}`, {
        method: 'DELETE',
      }),

    /** Anúncio de exemplo no canal da conta — o botão "testar" do painel. */
    testSocialAccount: (guildId: string, accountId: string): Promise<SocialTestResult> =>
      request(
        SocialTestResultSchema,
        `${guild(guildId)}/social/${encodeURIComponent(accountId)}/test`,
        { method: 'POST' },
      ),

    /** Jogos, squads vivos, propostas abertas e contadores do módulo de squads. */
    squadsOverview: (guildId: string): Promise<SquadOverview> =>
      request(SquadOverviewSchema, `${guild(guildId)}/squads/overview`),

    /** Publica ou reedita a mensagem fixa do canal de busca. Só admin. */
    postSquadSearchMessage: (
      guildId: string,
      input: PostSquadSearchMessageInput,
    ): Promise<PostSquadSearchMessageResult> =>
      request(PostSquadSearchMessageResultSchema, `${guild(guildId)}/squads/search-message`, {
        method: 'POST',
        body: PostSquadSearchMessageInputSchema.parse(input),
      }),

    /** Arquiva pelo painel (mod ou acima): canal só leitura e voice liberado. */
    archiveSquad: (
      guildId: string,
      squadId: string,
      input: ArchiveSquadInput,
    ): Promise<SquadSummary> =>
      request(
        SquadSummarySchema,
        `${guild(guildId)}/squads/${encodeURIComponent(squadId)}/archive`,
        { method: 'POST', body: ArchiveSquadInputSchema.parse(input) },
      ),

    /** Renomeia pelo painel (mod ou acima); o canal acompanha quando o Discord deixa. */
    renameSquad: (
      guildId: string,
      squadId: string,
      input: RenameSquadInput,
    ): Promise<SquadSummary> =>
      request(
        SquadSummarySchema,
        `${guild(guildId)}/squads/${encodeURIComponent(squadId)}/rename`,
        { method: 'POST', body: RenameSquadInputSchema.parse(input) },
      ),

    /** Roda o matcher do jogo agora, sem esperar o passo diário do job. Só admin. */
    runSquadMatch: (
      guildId: string,
      gameId: string,
      input: RunSquadMatchInput,
    ): Promise<RunSquadMatchResult> =>
      request(
        RunSquadMatchResultSchema,
        `${guild(guildId)}/squads/games/${encodeURIComponent(gameId)}/match`,
        { method: 'POST', body: RunSquadMatchInputSchema.parse(input) },
      ),
  };
}

export type InternalClient = ReturnType<typeof createInternalClient>;
