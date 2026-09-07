import { SOCIAL_KINDS_BY_PLATFORM, SOCIAL_PLATFORMS } from '@cobot/shared';

import { InstagramProvider } from './instagram';
import { TikTokProvider } from './tiktok';
import { TwitchProvider } from './twitch';
import { YouTubeProvider } from './youtube';

import type { SocialProvider } from './types';
import type { SocialKind, SocialPlatform, SocialPlatformStatus } from '@cobot/shared';

export * from './types';
export { parseYouTubeFeed, YouTubeProvider, type YouTubeFeedEntry } from './youtube';
export { TwitchProvider } from './twitch';
export { InstagramProvider } from './instagram';
export { parseTikTokProfile, TikTokProvider } from './tiktok';

export interface SocialProvidersOptions {
  youtubeApiKey?: string;
  twitchClientId?: string;
  twitchClientSecret?: string;
  metaAccessToken?: string;
  tiktokEnabled?: boolean;
  fetch?: typeof globalThis.fetch;
}

/**
 * Os quatro providers num registro só. O job pede um pela plataforma e não
 * sabe mais nada sobre elas; o painel pede `statuses()` para dizer, antes de o
 * usuário criar a conta, o que funciona neste processo e o que não funciona.
 */
export class SocialProviders {
  private readonly youtube: YouTubeProvider;
  private readonly byPlatform: Record<SocialPlatform, SocialProvider>;

  constructor(options: SocialProvidersOptions = {}) {
    this.youtube = new YouTubeProvider({
      ...(options.youtubeApiKey ? { apiKey: options.youtubeApiKey } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    this.byPlatform = {
      youtube: this.youtube,
      twitch: new TwitchProvider({
        ...(options.twitchClientId ? { clientId: options.twitchClientId } : {}),
        ...(options.twitchClientSecret ? { clientSecret: options.twitchClientSecret } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      }),
      instagram: new InstagramProvider({
        ...(options.metaAccessToken ? { accessToken: options.metaAccessToken } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      }),
      tiktok: new TikTokProvider({
        enabled: options.tiktokEnabled ?? false,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      }),
    };
  }

  get(platform: SocialPlatform): SocialProvider {
    return this.byPlatform[platform];
  }

  /** O que cada plataforma consegue fazer agora, com o motivo quando não dá. */
  statuses(): SocialPlatformStatus[] {
    return SOCIAL_PLATFORMS.map((platform) => {
      const reason = this.byPlatform[platform].unavailableReason();
      return {
        platform,
        available: reason === null,
        reason,
        kinds: this.kindsFor(platform),
      };
    });
  }

  /**
   * `live` do YouTube depende da API key, e só dela: sem a chave o canal
   * continua anunciando vídeo e short normalmente.
   */
  private kindsFor(platform: SocialPlatform): SocialKind[] {
    const kinds: SocialKind[] = [...SOCIAL_KINDS_BY_PLATFORM[platform]];
    if (platform !== 'youtube' || this.youtube.liveUnavailableReason() === null) return kinds;
    return kinds.filter((kind) => kind !== 'live');
  }
}
