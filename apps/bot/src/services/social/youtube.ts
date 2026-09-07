import { SECOND_MS, YOUTUBE_LIVE_POLL_SECONDS } from '@cobot/shared';

import { socialFetch, socialFetchOk } from './http';
import { SocialProviderError } from './types';

import type { SocialAccountRef, SocialItem, SocialProvider } from './types';

/** Quantas entradas do feed o job olha por passada. */
export const YOUTUBE_FEED_LIMIT = 5;

export const YOUTUBE_FEED_URL = 'https://www.youtube.com/feeds/videos.xml';
export const YOUTUBE_API_URL = 'https://www.googleapis.com/youtube/v3';

/** Uma entrada do feed Atom, antes de saber se é short ou vídeo comum. */
export interface YouTubeFeedEntry {
  videoId: string;
  title: string;
  author: string;
  url: string;
  thumbnail: string | null;
  publishedAt: Date | null;
}

const ENTRY_RE = /<entry\b[\s\S]*?<\/entry>/g;
const VIDEO_ID_RE = /<yt:videoId>([^<]+)<\/yt:videoId>/;
const TITLE_RE = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/;
const AUTHOR_RE = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>/;
const PUBLISHED_RE = /<published>([^<]+)<\/published>/;
const THUMBNAIL_RE = /<media:thumbnail\b[^>]*\burl="([^"]+)"/;

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Decodifica as entidades XML que o feed do YouTube realmente usa. */
export function decodeXml(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return XML_ENTITIES[entity] ?? match;
  });
}

/**
 * Lê o feed Atom de uploads de um canal. É um parser por regex de propósito: o
 * formato é fixo, sempre gerado pelo mesmo servidor, e uma dependência de XML
 * a mais custaria memória na VM de 1 GB por nada.
 *
 * Entrada sem `videoId` é simplesmente ignorada — feed truncado não pode virar
 * exceção no meio de um ciclo.
 */
export function parseYouTubeFeed(xml: string): YouTubeFeedEntry[] {
  const entries: YouTubeFeedEntry[] = [];
  for (const block of xml.match(ENTRY_RE) ?? []) {
    const videoId = VIDEO_ID_RE.exec(block)?.[1]?.trim();
    if (!videoId) continue;

    const published = PUBLISHED_RE.exec(block)?.[1];
    const publishedAt = published ? new Date(published) : null;
    entries.push({
      videoId,
      title: decodeXml(TITLE_RE.exec(block)?.[1]?.trim() ?? '').slice(0, 256),
      author: decodeXml(AUTHOR_RE.exec(block)?.[1]?.trim() ?? ''),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnail: THUMBNAIL_RE.exec(block)?.[1] ?? null,
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
    });
  }
  return entries;
}

export interface YouTubeProviderOptions {
  /** Só é preciso para detectar lives; vídeo e short saem do RSS sem chave. */
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

/**
 * YouTube (PRD §5.8). Vídeos e shorts vêm do feed RSS público, sem cota e sem
 * chave. Distinguir os dois exige um `HEAD` em `/shorts/<id>`: o YouTube só
 * responde 200 nessa rota quando o vídeo é mesmo um short, e redireciona para
 * o `watch?v=` quando não é.
 *
 * Live é outra história: não aparece no RSS de forma confiável e obriga a Data
 * API v3, que cobra 100 unidades de cota por busca num teto diário de 10.000.
 * Por isso ela tem intervalo próprio de 15 min e só existe com `apiKey`.
 */
export class YouTubeProvider implements SocialProvider {
  readonly platform = 'youtube' as const;
  private readonly options: YouTubeProviderOptions;
  private readonly now: () => number;
  /** `videoId` → é short. IDs são imutáveis, então o cache nunca envelhece. */
  private readonly shortCache = new Map<string, boolean>();
  /** `accountId` → quando a última busca de live foi feita (cota). */
  private readonly lastLiveCheck = new Map<string, number>();

  constructor(options: YouTubeProviderOptions = {}) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  unavailableReason(): string | null {
    return null;
  }

  /** Motivo específico do tipo `live`, mostrado no painel ao lado do checkbox. */
  liveUnavailableReason(): string | null {
    return this.options.apiKey
      ? null
      : 'Detectar lives exige YOUTUBE_API_KEY (YouTube Data API v3).';
  }

  async fetchLatest(account: SocialAccountRef): Promise<SocialItem[]> {
    const wantsUpload = account.kinds.includes('video') || account.kinds.includes('short');
    const items: SocialItem[] = [];

    if (wantsUpload) items.push(...(await this.fetchUploads(account)));
    if (account.kinds.includes('live')) items.push(...(await this.fetchLive(account)));

    return items;
  }

  private async fetchUploads(account: SocialAccountRef): Promise<SocialItem[]> {
    const response = await socialFetchOk(
      `${YOUTUBE_FEED_URL}?channel_id=${encodeURIComponent(account.externalId)}`,
      { platform: this.platform, fetch: this.options.fetch },
    );
    const entries = parseYouTubeFeed(await response.text()).slice(0, YOUTUBE_FEED_LIMIT);

    const items: SocialItem[] = [];
    for (const entry of entries) {
      const kind = (await this.isShort(entry.videoId)) ? 'short' : 'video';
      if (!account.kinds.includes(kind)) continue;
      items.push({
        externalId: entry.videoId,
        kind,
        title: entry.title,
        url: kind === 'short' ? `https://www.youtube.com/shorts/${entry.videoId}` : entry.url,
        author: entry.author,
        thumbnail: entry.thumbnail,
        publishedAt: entry.publishedAt,
      });
    }
    return items;
  }

  /**
   * `200` em `/shorts/<id>` = short; qualquer redirect = vídeo comum. Um erro
   * de rede aqui não pode perder o anúncio, então o vídeo passa como comum —
   * errar o rótulo é melhor do que não avisar ninguém.
   */
  private async isShort(videoId: string): Promise<boolean> {
    const cached = this.shortCache.get(videoId);
    if (cached !== undefined) return cached;

    let short = false;
    try {
      const response = await socialFetch(`https://www.youtube.com/shorts/${videoId}`, {
        platform: this.platform,
        method: 'HEAD',
        redirect: 'manual',
        fetch: this.options.fetch,
      });
      short = response.status === 200;
    } catch {
      short = false;
    }

    // O cache acompanha o feed, não o canal inteiro: some o mais antigo.
    if (this.shortCache.size > 500) {
      const oldest = this.shortCache.keys().next().value;
      if (oldest !== undefined) this.shortCache.delete(oldest);
    }
    this.shortCache.set(videoId, short);
    return short;
  }

  private async fetchLive(account: SocialAccountRef): Promise<SocialItem[]> {
    const apiKey = this.options.apiKey;
    if (!apiKey) return [];

    // A cota é diária e global: mesmo que a conta esteja com intervalo de 1 min,
    // live só é consultada a cada 15.
    const at = this.now();
    const last = this.lastLiveCheck.get(account.id);
    if (last !== undefined && at - last < YOUTUBE_LIVE_POLL_SECONDS * SECOND_MS) return [];
    this.lastLiveCheck.set(account.id, at);

    const url = new URL(`${YOUTUBE_API_URL}/search`);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('channelId', account.externalId);
    url.searchParams.set('eventType', 'live');
    url.searchParams.set('type', 'video');
    url.searchParams.set('maxResults', '1');
    url.searchParams.set('key', apiKey);

    const response = await socialFetch(url.toString(), {
      platform: this.platform,
      fetch: this.options.fetch,
    });
    if (response.status === 403) {
      throw new SocialProviderError(
        'A YouTube Data API recusou a chave (cota diária ou chave inválida).',
        this.platform,
      );
    }
    if (!response.ok) {
      throw new SocialProviderError(
        `A YouTube Data API respondeu ${String(response.status)}.`,
        this.platform,
      );
    }

    const body = (await response.json()) as YouTubeSearchResponse;
    const item = body.items?.[0];
    const videoId = item?.id?.videoId;
    if (!item || !videoId) return [];

    const published = item.snippet?.publishedAt ? new Date(item.snippet.publishedAt) : null;
    return [
      {
        externalId: videoId,
        kind: 'live',
        title: item.snippet?.title ?? 'Live',
        url: `https://www.youtube.com/watch?v=${videoId}`,
        author: item.snippet?.channelTitle ?? '',
        thumbnail: item.snippet?.thumbnails?.high?.url ?? null,
        publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
      },
    ];
  }
}

interface YouTubeSearchResponse {
  items?: {
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      channelTitle?: string;
      publishedAt?: string;
      thumbnails?: { high?: { url?: string } };
    };
  }[];
}
