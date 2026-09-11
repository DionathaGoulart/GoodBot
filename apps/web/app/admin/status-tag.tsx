import { Tag } from '@/components/retro/tag';

import type { AdminGuildRow } from '@/lib/admin';
import type { TagTone } from '@/components/retro/tag';

/**
 * O status do servidor como o registro o guarda, traduzido para uma etiqueta.
 *
 * `demo` sozinho não basta: um `demo` com prazo correndo é um servidor sendo
 * atendido agora, e um `demo` já vencido é alguém esperando decisão. São
 * estados diferentes na mesma coluna, então são etiquetas diferentes — e a
 * demo gasta continua aparecendo como tal depois de voltar para a fila.
 *
 * `RECUSADO` (`expired`) é o convite que venceu na fila: não é bloqueio, e
 * convidar de novo funciona.
 */
export function StatusTag({ row }: { row: AdminGuildRow }) {
  const { label, tone } = describeStatus(row);
  return <Tag tone={tone}>{label}</Tag>;
}

export function describeStatus(row: AdminGuildRow): { label: string; tone: TagTone } {
  if (row.status === 'approved') return { label: 'APROVADO', tone: 'success' };
  if (row.status === 'blocked') return { label: 'BLOQUEADO', tone: 'error' };
  if (row.status === 'pending') {
    return row.demoSpent
      ? { label: 'DEMO GASTA', tone: 'warning' }
      : { label: 'ESPERANDO', tone: 'warning' };
  }
  if (row.status === 'expired') return { label: 'RECUSADO', tone: 'error' };
  return row.demoSpent
    ? { label: 'DEMO GASTA', tone: 'warning' }
    : { label: 'DEMO', tone: 'info' };
}

/** `há 3 dias`, `em 42 min` — distância legível sem biblioteca de datas. */
export function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const minutos = Math.round(abs / 60_000);
  const horas = Math.round(abs / 3_600_000);
  const dias = Math.round(abs / 86_400_000);

  const quanto =
    minutos < 60 ? `${String(minutos)} min` : horas < 48 ? `${String(horas)} h` : `${String(dias)} d`;
  return diff < 0 ? `há ${quanto}` : `em ${quanto}`;
}
