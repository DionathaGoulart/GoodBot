import type { SocialKind, SocialPlatform } from '@cobot/shared';

/** Uma publicação vista numa plataforma, já normalizada (PRD §5.8). */
export interface SocialItem {
  /** ID estável na plataforma; é a chave do dedupe em `social_posts`. */
  externalId: string;
  kind: SocialKind;
  title: string;
  url: string;
  /** Nome de quem publicou, como a plataforma devolve. */
  author: string;
  thumbnail: string | null;
  publishedAt: Date | null;
}

/** O que um provider precisa saber da conta. Nunca a linha inteira do banco. */
export interface SocialAccountRef {
  id: string;
  platform: SocialPlatform;
  externalId: string;
  kinds: readonly SocialKind[];
}

/**
 * Todo provider tem a mesma cara para o job não conhecer as diferenças entre
 * uma API REST com OAuth e um feed RSS público.
 *
 * `fetchLatest` devolve as publicações **mais recentes primeiro** e pode
 * lançar: o job conta a falha, aplica backoff e desliga a conta no décimo erro.
 */
export interface SocialProvider {
  readonly platform: SocialPlatform;
  /**
   * Motivo pelo qual a plataforma não funciona neste processo (credencial
   * faltando, integração desligada); `null` quando está tudo certo. O painel
   * mostra este texto em vez de deixar criar uma conta que nunca anunciaria.
   */
  unavailableReason(): string | null;
  fetchLatest(account: SocialAccountRef): Promise<SocialItem[]>;
}

/** Erro de provider com mensagem legível — o job usa como `disabled_reason`. */
export class SocialProviderError extends Error {
  constructor(
    message: string,
    readonly platform: SocialPlatform,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'SocialProviderError';
  }
}
