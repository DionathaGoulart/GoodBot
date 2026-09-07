import { socialFetch } from './http';
import { SocialProviderError } from './types';

import type { SocialAccountRef, SocialItem, SocialProvider } from './types';

export const META_GRAPH_URL = 'https://graph.facebook.com/v21.0';

/** Quantas mídias o job olha por passada. */
export const INSTAGRAM_LIMIT = 5;

export interface InstagramProviderOptions {
  /** Token de longa duração do app na Meta. */
  accessToken?: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * Instagram/Reels pela Graph API da Meta (PRD §5.8). Os pré-requisitos são
 * pesados e ficam **fora** do código: conta Business ou Creator vinculada a uma
 * Página do Facebook, um app na Meta e as permissões `instagram_basic` +
 * `pages_show_list` aprovadas.
 *
 * Sem `META_ACCESS_TOKEN` o provider se declara indisponível com o motivo, e o
 * painel mostra isso na cara do usuário — o PRD é explícito em não falhar em
 * silêncio aqui.
 */
export class InstagramProvider implements SocialProvider {
  readonly platform = 'instagram' as const;
  private readonly options: InstagramProviderOptions;

  constructor(options: InstagramProviderOptions = {}) {
    this.options = options;
  }

  unavailableReason(): string | null {
    if (!this.options.accessToken) {
      return (
        'Falta META_ACCESS_TOKEN. Exige conta Business/Creator ligada a uma Página do ' +
        'Facebook e as permissões instagram_basic + pages_show_list aprovadas na Meta.'
      );
    }
    return null;
  }

  async fetchLatest(account: SocialAccountRef): Promise<SocialItem[]> {
    const reason = this.unavailableReason();
    if (reason) throw new SocialProviderError(reason, this.platform);
    if (!account.kinds.includes('post')) return [];

    const url = new URL(`${META_GRAPH_URL}/${encodeURIComponent(account.externalId)}/media`);
    url.searchParams.set(
      'fields',
      'id,caption,media_type,permalink,thumbnail_url,media_url,timestamp,username',
    );
    url.searchParams.set('limit', String(INSTAGRAM_LIMIT));
    url.searchParams.set('access_token', this.options.accessToken ?? '');

    const response = await socialFetch(url.toString(), {
      platform: this.platform,
      fetch: this.options.fetch,
    });
    if (response.status === 400 || response.status === 401) {
      throw new SocialProviderError(
        'A Meta recusou o token (expirado ou sem permissão para esta conta).',
        this.platform,
      );
    }
    if (!response.ok) {
      throw new SocialProviderError(
        `A Graph API respondeu ${String(response.status)}.`,
        this.platform,
      );
    }

    const body = (await response.json()) as { data?: InstagramMedia[] };
    return (body.data ?? []).map((media) => {
      const published = media.timestamp ? new Date(media.timestamp) : null;
      return {
        externalId: media.id,
        kind: 'post' as const,
        // A legenda é o único texto que existe; o embed não pode ficar vazio.
        title: (media.caption ?? 'Nova publicação').slice(0, 256),
        url: media.permalink ?? `https://www.instagram.com/p/${media.id}`,
        author: media.username ?? '',
        // Vídeo não tem `media_url` servível como imagem: usa a capa.
        thumbnail: media.thumbnail_url ?? media.media_url ?? null,
        publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
      };
    });
  }
}

interface InstagramMedia {
  id: string;
  caption?: string;
  media_type?: string;
  permalink?: string;
  thumbnail_url?: string;
  media_url?: string;
  timestamp?: string;
  username?: string;
}
