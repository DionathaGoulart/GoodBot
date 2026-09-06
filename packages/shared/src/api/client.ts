import { ApiErrorSchema, ApiOkSchema } from './common';
import { InvalidateInputSchema } from './config';
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

import type { ApiError } from './common';
import type { InvalidateInput } from './config';
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
  method?: 'GET' | 'POST';
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

    moderate: (guildId: string, input: ModerationActionInput): Promise<ModerationActionResult> =>
      request(ModerationActionResultSchema, `${guild(guildId)}/moderation`, {
        method: 'POST',
        body: ModerationActionInputSchema.parse(input),
      }),

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
  };
}

export type InternalClient = ReturnType<typeof createInternalClient>;
