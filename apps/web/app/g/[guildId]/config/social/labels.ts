import type { SocialKind, SocialPlatform } from '@cobot/shared';

/** Os mesmos rótulos que o bot usa nos anúncios (`services/social/announce`). */
export const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  youtube: 'YouTube',
  twitch: 'Twitch',
  instagram: 'Instagram',
  tiktok: 'TikTok',
};

export const KIND_LABEL: Record<SocialKind, string> = {
  video: 'vídeo',
  short: 'short',
  live: 'live',
  post: 'publicação',
};
