import type { SocialKind } from '@goodbot/shared';

/** Os cargos de uma conta, do jeito que a linha do banco os guarda. */
export interface SocialMentionRoles {
  mentionRoleIds: readonly string[];
  liveMentionRoleIds: readonly string[];
}

/**
 * Quais cargos o anúncio de `kind` pode pingar. Vídeo e short dividem uma
 * lista, live tem a sua. Não há fallback de propósito: quem deixa uma das duas
 * vazia quer aquele tipo sem ping, e cair na outra lista desfaria essa escolha.
 *
 * O job e o anúncio de teste passam por aqui, para o teste pingar exatamente
 * quem a publicação de verdade pingaria.
 */
export function mentionRolesFor(roles: SocialMentionRoles, kind: SocialKind): string[] {
  return [...(kind === 'live' ? roles.liveMentionRoleIds : roles.mentionRoleIds)];
}
