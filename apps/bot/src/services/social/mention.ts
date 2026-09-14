import type { SocialKind } from '@goodbot/shared';

/** Os dois cargos de uma conta, do jeito que a linha do banco os guarda. */
export interface SocialMentionRoles {
  mentionRoleId: string | null;
  liveMentionRoleId: string | null;
}

/**
 * Qual cargo o anúncio de `kind` pode pingar. Vídeo e short dividem um cargo,
 * live tem o seu. Não há fallback de propósito: quem deixa um dos dois vazio
 * quer aquele tipo sem ping, e cair no outro cargo desfaria essa escolha.
 *
 * O job e o anúncio de teste passam por aqui, para o teste pingar exatamente
 * quem a publicação de verdade pingaria.
 */
export function mentionRoleFor(roles: SocialMentionRoles, kind: SocialKind): string | null {
  return kind === 'live' ? roles.liveMentionRoleId : roles.mentionRoleId;
}
