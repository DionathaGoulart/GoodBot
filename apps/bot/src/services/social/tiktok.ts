import { socialFetch } from './http';
import { SocialProviderError } from './types';

import type { SocialAccountRef, SocialItem, SocialProvider } from './types';

/** Quantos vídeos o job olha por passada. */
export const TIKTOK_LIMIT = 5;

const ITEM_ID_RE = /"(?:id|itemId)"\s*:\s*"(\d{15,25})"/g;
const TITLE_RE = /"desc"\s*:\s*"((?:[^"\\]|\\.)*)"/;

export interface TikTokProviderOptions {
  /** Sem isto o provider fica desligado — é o padrão (PRD §5.8). */
  enabled?: boolean;
  fetch?: typeof globalThis.fetch;
}

/**
 * TikTok — **melhor esforço, sem promessa de suporte** (PRD §5.8). Não existe
 * API pública que sirva: a Content Posting API é de publicação e a Display API
 * exige aprovação comercial. O que sobra é ler a página pública do perfil, que
 * pode mudar de formato ou passar a exigir captcha a qualquer momento.
 *
 * Por isso ele nasce desligado (`SOCIAL_TIKTOK_ENABLED`), fica isolado num
 * arquivo só e o painel avisa a instabilidade antes de deixar criar a conta.
 */
export class TikTokProvider implements SocialProvider {
  readonly platform = 'tiktok' as const;
  private readonly options: TikTokProviderOptions;

  constructor(options: TikTokProviderOptions = {}) {
    this.options = options;
  }

  unavailableReason(): string | null {
    if (!this.options.enabled) {
      return 'Integração de melhor esforço, desligada por padrão. Ligue com SOCIAL_TIKTOK_ENABLED=true.';
    }
    return null;
  }

  async fetchLatest(account: SocialAccountRef): Promise<SocialItem[]> {
    const reason = this.unavailableReason();
    if (reason) throw new SocialProviderError(reason, this.platform);
    if (!account.kinds.includes('video')) return [];

    const response = await socialFetch(
      `https://www.tiktok.com/@${encodeURIComponent(account.externalId)}`,
      { platform: this.platform, fetch: this.options.fetch },
    );
    if (!response.ok) {
      throw new SocialProviderError(
        `O TikTok respondeu ${String(response.status)} (a página pública mudou ou bloqueou o bot).`,
        this.platform,
      );
    }

    return parseTikTokProfile(await response.text(), account.externalId).slice(0, TIKTOK_LIMIT);
  }
}

/**
 * Extrai os IDs de vídeo do JSON embutido na página do perfil. Exportado para
 * o teste: é a parte que quebra quando o TikTok muda o HTML, e é bom que a
 * suíte diga isso em vez de o canal ficar mudo.
 */
export function parseTikTokProfile(html: string, username: string): SocialItem[] {
  const title = TITLE_RE.exec(html)?.[1];
  const seen = new Set<string>();
  const items: SocialItem[] = [];

  for (const match of html.matchAll(ITEM_ID_RE)) {
    const id = match[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    items.push({
      externalId: id,
      kind: 'video',
      title: title ? unescapeJson(title).slice(0, 256) : 'Novo vídeo',
      url: `https://www.tiktok.com/@${username}/video/${id}`,
      author: `@${username}`,
      thumbnail: null,
      publishedAt: null,
    });
  }
  return items;
}

function unescapeJson(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}
