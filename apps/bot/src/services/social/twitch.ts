import { SECOND_MS } from '@cobot/shared';

import { socialFetch } from './http';
import { SocialProviderError } from './types';

import type { SocialAccountRef, SocialItem, SocialProvider } from './types';

export const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
export const TWITCH_HELIX_URL = 'https://api.twitch.tv/helix';

/** Margem de segurança na expiração do token: renova antes de estourar. */
const TOKEN_SKEW_MS = 60 * SECOND_MS;

export interface TwitchProviderOptions {
  clientId?: string;
  clientSecret?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

/**
 * Twitch (PRD §5.8). Helix `streams` com App Access Token (client credentials).
 * O PRD prefere polling a EventSub justamente por não exigir rota pública de
 * callback — a API do bot já está exposta e §7.3 proíbe endpoint sem auth.
 *
 * O dedupe é pelo `stream.id`: enquanto a mesma sessão continuar no ar, o ID
 * não muda e o anúncio não repete. Uma live nova (mesmo no mesmo dia) ganha
 * ID novo e é anunciada de novo, que é o comportamento esperado.
 */
export class TwitchProvider implements SocialProvider {
  readonly platform = 'twitch' as const;
  private readonly options: TwitchProviderOptions;
  private readonly now: () => number;
  private token: CachedToken | null = null;

  constructor(options: TwitchProviderOptions = {}) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  unavailableReason(): string | null {
    if (!this.options.clientId || !this.options.clientSecret) {
      return 'Faltam TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET (dev.twitch.tv/console/apps).';
    }
    return null;
  }

  async fetchLatest(account: SocialAccountRef): Promise<SocialItem[]> {
    const reason = this.unavailableReason();
    if (reason) throw new SocialProviderError(reason, this.platform);
    if (!account.kinds.includes('live')) return [];

    const stream = await this.currentStream(account.externalId);
    if (!stream) return [];

    const startedAt = stream.started_at ? new Date(stream.started_at) : null;
    return [
      {
        externalId: stream.id,
        kind: 'live',
        title: stream.title || `${stream.user_name} está ao vivo`,
        url: `https://twitch.tv/${stream.user_login}`,
        author: stream.user_name,
        // O `thumbnail_url` vem com placeholders de tamanho no próprio texto.
        thumbnail: stream.thumbnail_url
          ? stream.thumbnail_url.replace('{width}', '1280').replace('{height}', '720')
          : null,
        publishedAt: startedAt && !Number.isNaN(startedAt.getTime()) ? startedAt : null,
      },
    ];
  }

  private async currentStream(login: string): Promise<TwitchStream | null> {
    const response = await socialFetch(
      `${TWITCH_HELIX_URL}/streams?user_login=${encodeURIComponent(login)}`,
      {
        platform: this.platform,
        headers: {
          'client-id': this.options.clientId ?? '',
          authorization: `Bearer ${await this.accessToken()}`,
        },
        fetch: this.options.fetch,
      },
    );

    if (response.status === 401) {
      // Token revogado no meio do caminho: descarta e deixa a próxima passada
      // pedir um novo, em vez de queimar a tentativa desta conta.
      this.token = null;
      throw new SocialProviderError('A Twitch recusou o token do app.', this.platform);
    }
    if (!response.ok) {
      throw new SocialProviderError(
        `A Twitch respondeu ${String(response.status)}.`,
        this.platform,
      );
    }

    const body = (await response.json()) as { data?: TwitchStream[] };
    // Sem `data` = canal offline. Não é erro nenhum.
    return body.data?.[0] ?? null;
  }

  /** App Access Token cacheado até expirar (client credentials, sem usuário). */
  private async accessToken(): Promise<string> {
    const cached = this.token;
    if (cached && cached.expiresAt > this.now()) return cached.value;

    const params = new URLSearchParams({
      client_id: this.options.clientId ?? '',
      client_secret: this.options.clientSecret ?? '',
      grant_type: 'client_credentials',
    });
    const response = await socialFetch(TWITCH_TOKEN_URL, {
      platform: this.platform,
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      fetch: this.options.fetch,
    });
    if (!response.ok) {
      throw new SocialProviderError(
        'A Twitch recusou as credenciais do app (confira TWITCH_CLIENT_ID/SECRET).',
        this.platform,
      );
    }

    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) {
      throw new SocialProviderError('A Twitch não devolveu um token.', this.platform);
    }
    const ttl = (body.expires_in ?? 3600) * SECOND_MS;
    this.token = { value: body.access_token, expiresAt: this.now() + ttl - TOKEN_SKEW_MS };
    return body.access_token;
  }
}

interface TwitchStream {
  id: string;
  user_login: string;
  user_name: string;
  title: string;
  started_at?: string;
  thumbnail_url?: string;
}
