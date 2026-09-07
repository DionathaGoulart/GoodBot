import type { TagTone } from '@/components/retro/tag';

/** §2.3 — a cor de cada ação de moderação é fixa nos dois temas. */
export const CASE_TONES: Record<string, TagTone> = {
  ban: 'error',
  softban: 'error',
  kick: 'warning',
  timeout: 'warning',
  warn: 'info',
  unban: 'success',
  untimeout: 'success',
  note: 'muted',
};
