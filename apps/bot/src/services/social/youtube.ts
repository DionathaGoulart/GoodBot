import { SOCIAL_KIND_HEADLINE } from '@cobot/shared';

import { socialFetch, socialFetchOk } from './http';
import { SocialProviderError } from './types';

import type { SocialAccountRef, SocialItem, SocialProvider } from './types';

/** Quantas entradas do feed o job olha por passada. */
export const YOUTUBE_FEED_LIMIT = 5;

export const YOUTUBE_FEED_URL = 'https://www.youtube.com/feeds/videos.xml';
export const YOUTUBE_BASE_URL = 'https://www.youtube.com';

/** Teto do cache de classificação. `videoId` é imutável, então nunca expira. */
export const YOUTUBE_KIND_CACHE_MAX = 500;

/** Uma entrada do feed Atom, antes de saber se é short, vídeo ou live. */
export interface YouTubeFeedEntry {
  videoId: string;
  title: string;
  author: string;
  url: string;
  thumbnail: string | null;
  publishedAt: Date | null;
}

/** O que o YouTube diz sobre um vídeo. `upcoming` = agendada, não anuncia. */
export type YouTubeKind = 'video' | 'short' | 'live';
export type YouTubeClassification = YouTubeKind | 'upcoming';

/** Um canal resolvido a partir de uma URL, um `@handle` ou um `UC…`. */
export interface YouTubeChannel {
  channelId: string;
  title: string | null;
  handle: string | null;
  avatarUrl: string | null;
}

const ENTRY_RE = /<entry\b[\s\S]*?<\/entry>/g;
const VIDEO_ID_RE = /<yt:videoId>([^<]+)<\/yt:videoId>/;
const TITLE_RE = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/;
const AUTHOR_RE = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>/;
const PUBLISHED_RE = /<published>([^<]+)<\/published>/;
const THUMBNAIL_RE = /<media:thumbnail\b[^>]*\burl="([^"]+)"/;
const CHANNEL_ID_TAG_RE = /<yt:channelId>([^<]+)<\/yt:channelId>/;

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
      url: `${YOUTUBE_BASE_URL}/watch?v=${videoId}`,
      thumbnail: THUMBNAIL_RE.exec(block)?.[1] ?? null,
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
    });
  }
  return entries;
}

/**
 * Cabeçalho do feed (antes da primeira `<entry>`): é o bastante para provar
 * que um `UC…` existe sem baixar a página do canal.
 */
export function parseFeedChannel(xml: string): { channelId: string | null; title: string | null } {
  const head = xml.split('<entry')[0] ?? xml;
  const title = decodeXml(TITLE_RE.exec(head)?.[1]?.trim() ?? '');
  return {
    channelId: CHANNEL_ID_TAG_RE.exec(head)?.[1]?.trim() ?? null,
    title: title || null,
  };
}

// ── Parsers de HTML ─────────────────────────────────────────────────────────
//
// Três páginas públicas do YouTube substituem a Data API v3 inteira. São
// parsers por regex pela mesma razão do feed: um servidor só, formato estável,
// e uma fixture recortada no teste avisa alto se ele mudar. Todos toleram
// campo ausente devolvendo `null` — nenhum deles lança.

const CANONICAL_TAG_RE = /<link\b[^>]*\brel=["']canonical["'][^>]*>/i;
const HREF_RE = /\bhref=["']([^"']+)["']/i;
const CONTENT_RE = /\bcontent=["']([^"']*)["']/i;
const WATCH_ID_RE = /[?&]v=([A-Za-z0-9_-]{11})/;
const CHANNEL_ID_URL_RE = /\/channel\/(UC[A-Za-z0-9_-]{22})/;
const CANONICAL_BASE_HANDLE_RE = /"canonicalBaseUrl"\s*:\s*"\/(@[^"\\]+)"/;
const JSON_AUTHOR_RE = /"author"\s*:\s*"((?:[^"\\]|\\.)*)"/;
const VIDEO_DETAILS_TITLE_RE = /"videoDetails"\s*:\s*\{[^{}]*?"title"\s*:\s*"((?:[^"\\]|\\.)*)"/;

/**
 * A capa de qualquer vídeo, deduzida do ID. `hqdefault.jpg` existe para todo
 * vídeo — inclusive transmissão ao vivo — e não vem com os parâmetros de
 * assinatura que o YouTube gruda nas URLs do HTML.
 */
export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/** `<link rel="canonical">` da página, decodificado. `null` se não houver. */
export function parseCanonical(html: string): string | null {
  const tag = CANONICAL_TAG_RE.exec(html)?.[0];
  if (!tag) return null;
  const href = HREF_RE.exec(tag)?.[1];
  return href ? decodeXml(href) : null;
}

function metaContent(html: string, property: string): string | null {
  const tag = new RegExp(
    `<meta\\b[^>]*\\b(?:property|name|itemprop)=["']${property}["'][^>]*>`,
    'i',
  ).exec(html)?.[0];
  if (!tag) return null;
  const content = CONTENT_RE.exec(tag)?.[1];
  return content ? decodeXml(content) : null;
}

/** Desescapa uma string JSON crua (`\u00e9`, `\"`) sem confiar no formato. */
function decodeJsonString(raw: string): string | null {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return null;
  }
}

export interface YouTubeWatchState {
  /** Transmitindo agora. É o único estado que vira anúncio de live. */
  isLive: boolean;
  /** Live ou premiere **agendada**: fica em espera, não é anunciada. */
  isUpcoming: boolean;
  /** Nasceu como transmissão (serve para reconhecer o VOD de uma live). */
  isLiveContent: boolean;
  title: string | null;
  author: string | null;
  thumbnail: string | null;
}

/**
 * O estado de um vídeo a partir do HTML de `watch?v=` (ou de `/live`, que é a
 * mesma página). Os três booleanos vêm do `ytInitialPlayerResponse`; o resto,
 * das metatags `og:` que o YouTube serve justamente para quem não roda JS.
 */
export function parseWatchState(html: string): YouTubeWatchState {
  const author = JSON_AUTHOR_RE.exec(html)?.[1];
  const jsonTitle = VIDEO_DETAILS_TITLE_RE.exec(html)?.[1];
  return {
    isLive: /"isLive"\s*:\s*true/.test(html),
    isUpcoming: /"isUpcoming"\s*:\s*true/.test(html),
    isLiveContent: /"isLiveContent"\s*:\s*true/.test(html),
    // Três fontes porque o YouTube não serve as mesmas em toda rota: um
    // `watch?v=` traz `og:`, mas a página de `/channel/<id>/live` traz só
    // `<meta name="title">` e o JSON do player (verificado em 2026-09-08).
    title:
      metaContent(html, 'og:title') ??
      metaContent(html, 'title') ??
      (jsonTitle ? decodeJsonString(jsonTitle) : null),
    author: author ? decodeJsonString(author) : null,
    thumbnail: metaContent(html, 'og:image'),
  };
}

export interface YouTubeChannelPage {
  channelId: string | null;
  title: string | null;
  handle: string | null;
  avatarUrl: string | null;
}

/**
 * A página de um canal (`/@handle`, `/c/…`, `/user/…`, `/channel/UC…`). O
 * `UC…` sai do canonical, que o YouTube normaliza para a forma `/channel/`
 * seja qual for a URL de entrada — é isso que resolve `@handle` sem API.
 */
export function parseChannelPage(html: string): YouTubeChannelPage {
  const canonical = parseCanonical(html);
  const handle = CANONICAL_BASE_HANDLE_RE.exec(html)?.[1];
  return {
    channelId: canonical ? (CHANNEL_ID_URL_RE.exec(canonical)?.[1] ?? null) : null,
    title: metaContent(html, 'og:title'),
    handle: handle ?? null,
    avatarUrl: metaContent(html, 'og:image'),
  };
}

// ── Resolução de entrada ────────────────────────────────────────────────────

const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE_RE = /^@[A-Za-z0-9._-]{3,30}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

/**
 * O que o usuário digitou, traduzido para uma de duas coisas: um `UC…` pronto
 * ou a URL da página de canal a buscar. `null` = nem parece YouTube.
 */
export function parseChannelInput(
  input: string,
): { channelId: string } | { pageUrl: string } | null {
  const value = input.trim();
  if (!value) return null;
  if (CHANNEL_ID_RE.test(value)) return { channelId: value };
  if (HANDLE_RE.test(value)) return { pageUrl: `${YOUTUBE_BASE_URL}/${value}` };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;

  const [first, second] = url.pathname.split('/').filter(Boolean);
  if (!first) return null;
  if (first === 'channel') {
    return second && CHANNEL_ID_RE.test(second) ? { channelId: second } : null;
  }
  if (first.startsWith('@')) {
    return HANDLE_RE.test(first) ? { pageUrl: `${YOUTUBE_BASE_URL}/${first}` } : null;
  }
  if ((first === 'c' || first === 'user') && second) {
    return { pageUrl: `${YOUTUBE_BASE_URL}/${first}/${encodeURIComponent(second)}` };
  }
  return null;
}

export interface YouTubeProviderOptions {
  fetch?: typeof globalThis.fetch;
}

const NOT_FOUND = 'Não encontrei esse canal no YouTube.';

/**
 * YouTube (PRD §5.8). Sem chave, sem cota, sem Google Cloud: tudo sai de três
 * páginas públicas.
 *
 * · **RSS** (`feeds/videos.xml`) lista as publicações recentes — inclusive a
 *   live em andamento, que aparece no feed como qualquer vídeo;
 * · **`/channel/UC…/live`** responde com a página do `watch` da transmissão
 *   atual (canonical `watch?v=`), ou com a do próprio canal quando não há
 *   live. É a sonda em tempo real que a Data API cobrava 100 unidades para
 *   fazer com 15 min de atraso;
 * · **`watch?v=`** separa live de vídeo comum e revela a live *agendada*
 *   (`"isUpcoming":true`), que não deve ser anunciada até começar.
 *
 * Short continua sendo um `HEAD` em `/shorts/<id>`: o YouTube só responde 200
 * nessa rota quando o vídeo é mesmo um short, e redireciona quando não é.
 */
export class YouTubeProvider implements SocialProvider {
  readonly platform = 'youtube' as const;
  private readonly options: YouTubeProviderOptions;
  /** `videoId` → tipo final. Nunca guarda `upcoming`: aquilo ainda vai mudar. */
  private readonly kindCache = new Map<string, YouTubeKind>();

  constructor(options: YouTubeProviderOptions = {}) {
    this.options = options;
  }

  /**
   * Uma passada por conta: o feed (quando a conta quer vídeo/short) e a sonda
   * de live (quando quer live). Só IDs desconhecidos custam classificação — é
   * o `isKnown` que impede o feed de 15 entradas virar 30 requisições.
   *
   * Devolve da publicação mais nova para a mais antiga, com a live na frente.
   */
  async fetchLatest(account: SocialAccountRef): Promise<SocialItem[]> {
    const wantsUpload = account.kinds.includes('video') || account.kinds.includes('short');
    const wantsLive = account.kinds.includes('live');

    const entries = wantsUpload ? await this.fetchFeed(account.externalId) : [];
    const items: SocialItem[] = [];
    const seen = new Set<string>();

    // A live vem primeiro porque é a publicação mais recente por definição, e
    // porque ela costuma estar no feed também: quem chega antes fixa o tipo.
    if (wantsLive) {
      const live = await this.probeLive(account.externalId, entries);
      if (live) {
        items.push(live);
        seen.add(live.externalId);
      }
    }

    if (wantsUpload) {
      for (const entry of entries) {
        if (seen.has(entry.videoId)) continue;
        if (await account.isKnown(entry.videoId)) continue;

        const kind = await this.classify(entry.videoId);
        // Agendada não entra em `social_posts`: a próxima passada olha de novo.
        if (kind === 'upcoming' || !account.kinds.includes(kind)) continue;

        seen.add(entry.videoId);
        items.push({
          externalId: entry.videoId,
          kind,
          headline: SOCIAL_KIND_HEADLINE[kind],
          title: entry.title,
          url: kind === 'short' ? `${YOUTUBE_BASE_URL}/shorts/${entry.videoId}` : entry.url,
          author: entry.author,
          thumbnail: entry.thumbnail,
          publishedAt: entry.publishedAt,
        });
      }
    }

    return items;
  }

  /** As `YOUTUBE_FEED_LIMIT` publicações mais recentes do canal. */
  private async fetchFeed(channelId: string): Promise<YouTubeFeedEntry[]> {
    const response = await socialFetchOk(
      `${YOUTUBE_FEED_URL}?channel_id=${encodeURIComponent(channelId)}`,
      { platform: this.platform, fetch: this.options.fetch },
    );
    return parseYouTubeFeed(await response.text()).slice(0, YOUTUBE_FEED_LIMIT);
  }

  /**
   * A sonda de live. `entries` é só para enriquecer: quando a transmissão já
   * está no feed, título e capa saem de lá, que é onde vêm mais limpos.
   *
   * Canonical apontando para o canal = não tem live. Canonical **ausente** é
   * outra coisa: significa que a página mudou de formato, e aí é melhor a
   * conta falhar e alertar do que ficar muda achando que nunca há live.
   */
  async probeLive(
    channelId: string,
    entries: readonly YouTubeFeedEntry[] = [],
  ): Promise<SocialItem | null> {
    const response = await socialFetchOk(
      `${YOUTUBE_BASE_URL}/channel/${encodeURIComponent(channelId)}/live`,
      { platform: this.platform, fetch: this.options.fetch },
    );
    const html = await response.text();

    const canonical = parseCanonical(html);
    if (!canonical) {
      throw new SocialProviderError(
        'A página de live do canal mudou de formato e não pôde ser lida.',
        this.platform,
      );
    }

    const videoId = WATCH_ID_RE.exec(canonical)?.[1];
    if (!videoId) return null;

    const state = parseWatchState(html);
    if (!state.isLive || state.isUpcoming) return null;

    this.remember(videoId, 'live');
    const entry = entries.find((candidate) => candidate.videoId === videoId);
    return {
      externalId: videoId,
      kind: 'live',
      headline: SOCIAL_KIND_HEADLINE.live,
      title: entry?.title ?? state.title ?? 'Live',
      url: `${YOUTUBE_BASE_URL}/watch?v=${videoId}`,
      author: entry?.author ?? state.author ?? '',
      // A rota `/live` não traz `og:image`; a capa deduzida do ID sempre existe
      // e é a que o Discord consegue renderizar sem parâmetro de assinatura.
      thumbnail: entry?.thumbnail ?? state.thumbnail ?? youtubeThumbnailUrl(videoId),
      publishedAt: entry?.publishedAt ?? null,
    };
  }

  /**
   * Short, live, agendada ou vídeo comum — no máximo duas requisições, e só
   * na primeira vez que o ID aparece.
   *
   * Falha de rede aqui devolve `video`: errar o rótulo é melhor do que não
   * avisar ninguém, e o resultado errado não é cacheado.
   */
  async classify(videoId: string): Promise<YouTubeClassification> {
    const cached = this.kindCache.get(videoId);
    if (cached !== undefined) return cached;

    try {
      if (await this.isShort(videoId)) {
        this.remember(videoId, 'short');
        return 'short';
      }

      const response = await socialFetchOk(`${YOUTUBE_BASE_URL}/watch?v=${videoId}`, {
        platform: this.platform,
        fetch: this.options.fetch,
      });
      const state = parseWatchState(await response.text());
      if (state.isUpcoming) return 'upcoming';

      const kind: YouTubeKind = state.isLive ? 'live' : 'video';
      this.remember(videoId, kind);
      return kind;
    } catch {
      return 'video';
    }
  }

  /** `200` em `/shorts/<id>` = short; qualquer redirect = vídeo comum. */
  private async isShort(videoId: string): Promise<boolean> {
    const response = await socialFetch(`${YOUTUBE_BASE_URL}/shorts/${videoId}`, {
      platform: this.platform,
      method: 'HEAD',
      redirect: 'manual',
      fetch: this.options.fetch,
    });
    return response.status === 200;
  }

  /** O cache acompanha o feed, não o canal inteiro: some o mais antigo. */
  private remember(videoId: string, kind: YouTubeKind): void {
    if (this.kindCache.size >= YOUTUBE_KIND_CACHE_MAX) {
      const oldest = this.kindCache.keys().next().value;
      if (oldest !== undefined) this.kindCache.delete(oldest);
    }
    this.kindCache.set(videoId, kind);
  }

  /**
   * URL, `@handle` ou `UC…` → o canal. Um `UC…` só precisa ser confirmado, e o
   * feed confirma de graça; o resto exige a página, porque só o canonical dela
   * traduz `@handle`/`/c/`/`/user/` para o ID de verdade.
   */
  async resolveChannel(input: string): Promise<YouTubeChannel> {
    const parsed = parseChannelInput(input);
    if (!parsed) throw new SocialProviderError(NOT_FOUND, this.platform);

    if ('channelId' in parsed) {
      const feed = await this.fetchOrNotFound(
        `${YOUTUBE_FEED_URL}?channel_id=${encodeURIComponent(parsed.channelId)}`,
      );
      const channel = parseFeedChannel(await feed.text());
      return { channelId: parsed.channelId, title: channel.title, handle: null, avatarUrl: null };
    }

    const page = await this.fetchOrNotFound(parsed.pageUrl);
    const channel = parseChannelPage(await page.text());
    if (!channel.channelId) throw new SocialProviderError(NOT_FOUND, this.platform);
    return {
      channelId: channel.channelId,
      title: channel.title,
      handle: channel.handle,
      avatarUrl: channel.avatarUrl,
    };
  }

  /**
   * No cadastro, `404` não é "o YouTube está fora do ar": é o usuário tendo
   * digitado um canal que não existe, e a mensagem precisa dizer isso.
   */
  private async fetchOrNotFound(url: string): Promise<Response> {
    const response = await socialFetch(url, {
      platform: this.platform,
      fetch: this.options.fetch,
    });
    if (!response.ok) throw new SocialProviderError(NOT_FOUND, this.platform);
    return response;
  }
}
