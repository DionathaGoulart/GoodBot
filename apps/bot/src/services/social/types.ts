import type { SocialKind, SocialPlatform } from '@goodbot/shared';

/** Uma publicação vista numa plataforma, já normalizada (PRD §5.8). */
export interface SocialItem {
  /** ID estável na plataforma; é a chave do dedupe em `social_posts`. */
  externalId: string;
  kind: SocialKind;
  /**
   * O verbo do anúncio, já pronto para o template: "publicou um vídeo novo",
   * "publicou um short", "está ao vivo". Fica no item, e não só no `kind`,
   * porque é o provider quem sabe o que aconteceu — "publicou" uma live não
   * quer dizer nada (PRD §5.8).
   */
  headline: string;
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
  /**
   * Se a publicação já está em `social_posts`. O provider usa para **não**
   * gastar requisições classificando o que já foi anunciado — a consulta é do
   * job, porque provider não fala com o banco.
   */
  isKnown(externalId: string): Promise<boolean>;
}

/**
 * A cara que o job enxerga. Hoje só o YouTube a implementa; a interface fica
 * porque é ela que mantém o job ignorante de RSS, de canonical e de `/shorts`.
 *
 * `fetchLatest` devolve as publicações **mais recentes primeiro** e pode
 * lançar: o job conta a falha e desliga a conta no décimo erro seguido.
 */
export interface SocialProvider {
  readonly platform: SocialPlatform;
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
