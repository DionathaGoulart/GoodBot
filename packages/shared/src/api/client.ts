import { RaidModeInputSchema, RaidModeStateSchema } from './automod';
import { CaseDeleteInputSchema, CaseEditInputSchema, CaseSummarySchema } from './cases';
import {
  ChannelCreateInputSchema,
  ChannelOverridesInputSchema,
  ChannelUpdateInputSchema,
  GuildChannelDetailSchema,
  SlowmodeInputSchema,
} from './channels';
import { CommandSummarySchema } from './commands';
import { ApiErrorSchema, ApiOkSchema } from './common';
import { InvalidateInputSchema } from './config';
import {
  BanListQuerySchema,
  GuildBanPageSchema,
  GuildProfileSchema,
  GuildSettingsInputSchema,
} from './guild';
import { HealthResponseSchema } from './health';
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
  PublishPanelInputSchema,
  SendMessageInputSchema,
  SendMessageResultSchema,
} from './messages';
import { ModerationActionInputSchema, ModerationActionResultSchema } from './moderation';
import {
  ActorInputSchema,
  MemberRolesInputSchema,
  RoleMoveInputSchema,
  RoleWriteInputSchema,
} from './roles';
import {
  SocialAccountSummarySchema,
  SocialOverviewSchema,
  SocialTestResultSchema,
} from './social';
import { CloseTicketInputSchema, CloseTicketResultSchema } from './tickets';
import { SocialAccountInputSchema } from '../config/social';

import type { RaidModeInput, RaidModeState } from './automod';
import type { CaseDeleteInput, CaseEditInput, CaseSummary } from './cases';
import type {
  ChannelCreateInput,
  ChannelOverridesInput,
  ChannelUpdateInput,
  GuildChannelDetail,
  SlowmodeInput,
} from './channels';
import type { CommandSummary } from './commands';
import type { ApiError } from './common';
import type { InvalidateInput } from './config';
import type { BanListQuery, GuildBanPage, GuildProfile, GuildSettingsInput } from './guild';
import type { HealthResponse } from './health';
import type {
  AuditLogEntrySummary,
  AuditLogQuery,
  GuildChannelSummary,
  GuildMemberDetail,
  GuildMemberSummary,
  GuildRoleSummary,
  MemberSearchQuery,
} from './members';
import type { PublishPanelInput, SendMessageInput, SendMessageResult } from './messages';
import type { ModerationActionInput, ModerationActionResult } from './moderation';
import type { ActorInput, MemberRolesInput, RoleMoveInput, RoleWriteInput } from './roles';
import type { SocialAccountSummary, SocialOverview, SocialTestResult } from './social';
import type { CloseTicketInput, CloseTicketResult } from './tickets';
import type { SocialAccountInput } from '../config/social';
import type { z } from 'zod';

/** Timeout padrão de uma chamada; a API do bot é local a um datacenter. */
export const DEFAULT_TIMEOUT_MS = 10_000;

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
    { method = 'GET', query, body }: RequestOptions = {},
  ): Promise<z.infer<S>> {
    const signal = AbortSignal.timeout(timeoutMs);
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

    /** Dados do servidor + o que o bot pode editar nele (PRD §6.3). */
    guildProfile: (guildId: string): Promise<GuildProfile> =>
      request(GuildProfileSchema, guild(guildId)),

    updateGuildProfile: (guildId: string, input: GuildSettingsInput): Promise<GuildProfile> =>
      request(GuildProfileSchema, guild(guildId), {
        method: 'PATCH',
        body: GuildSettingsInputSchema.parse(input),
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

    channels: (guildId: string): Promise<GuildChannelSummary[]> =>
      request(GuildChannelSummarySchema.array(), `${guild(guildId)}/channels`),

    roles: (guildId: string): Promise<GuildRoleSummary[]> =>
      request(GuildRoleSummarySchema.array(), `${guild(guildId)}/roles`),

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

    /** Contas observadas + o que cada plataforma consegue fazer (PRD §5.8). */
    social: (guildId: string): Promise<SocialOverview> =>
      request(SocialOverviewSchema, `${guild(guildId)}/social`),

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
      request(SocialAccountSummarySchema, `${guild(guildId)}/social/${encodeURIComponent(accountId)}`, {
        method: 'PATCH',
        body: SocialAccountInputSchema.parse(input),
      }),

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
  };
}

export type InternalClient = ReturnType<typeof createInternalClient>;
