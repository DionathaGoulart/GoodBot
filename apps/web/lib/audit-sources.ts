import { AUDIT_SOURCES, type AuditSource } from '@cobot/shared';

import type { TagTone } from '@/components/retro/tag';

/**
 * Etapa 22 — a auditoria passou a contar também o que o bot faz sozinho, e a
 * origem é a primeira coisa que se lê numa linha. Puro de propósito: a tabela
 * é um client component e o card do dashboard é um server component, e os dois
 * usam este mesmo mapa.
 */

export const AUDIT_SOURCE_LABEL: Record<AuditSource, string> = {
  dashboard: 'PAINEL',
  command: 'COMANDO',
  automod: 'AUTOMOD',
  event: 'EVENTO',
  job: 'JOB',
};

/** §6.6 — o tom separa o que uma pessoa pediu do que o bot decidiu sozinho. */
export const AUDIT_SOURCE_TONES: Record<AuditSource, TagTone> = {
  dashboard: 'accent',
  command: 'info',
  automod: 'warning',
  event: 'success',
  job: 'muted',
};

export const AUDIT_SOURCE_OPTIONS = AUDIT_SOURCES.map((source) => ({
  value: source,
  label: AUDIT_SOURCE_LABEL[source],
}));

/**
 * Para onde uma linha aponta. `null` quando o alvo não tem página própria
 * (uma config, um cargo já apagado): a linha continua legível, só não clica.
 */
export function auditTargetHref(
  guildId: string,
  target: { targetType: string | null; targetId: string | null },
): string | null {
  const { targetType: type, targetId: id } = target;
  if (!id) return null;
  switch (type) {
    case 'member':
    case 'user':
      return `/g/${guildId}/membros/${id}`;
    case 'case':
      return `/g/${guildId}/casos/${id}`;
    case 'channel':
      return `/g/${guildId}/canais`;
    case 'role':
      return `/g/${guildId}/cargos`;
    case 'ticket':
      return `/g/${guildId}/config/tickets`;
    default:
      return null;
  }
}
