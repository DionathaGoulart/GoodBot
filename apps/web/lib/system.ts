import 'server-only';

import { internalApi } from './internal-api';

import type { HealthResponse } from '@cobot/shared';

export interface SystemHealth {
  /** `null` quando a API do bot não respondeu. */
  health: HealthResponse | null;
  /** Ida e volta do painel até o bot, em ms — a latência que o usuário sente. */
  roundTripMs: number | null;
  error: string | null;
}

/**
 * Estado do bot para o card "Saúde" (PRD §11). Mede o round-trip aqui e não no
 * bot: desde a v1.1 painel (Vercel) e bot (Oracle) estão em máquinas
 * diferentes, e essa latência é justamente um dos riscos a acompanhar.
 */
export async function loadSystemHealth(): Promise<SystemHealth> {
  const start = performance.now();
  try {
    const health = await internalApi().health();
    return { health, roundTripMs: Math.round(performance.now() - start), error: null };
  } catch (error) {
    return {
      health: null,
      roundTripMs: null,
      error: error instanceof Error ? error.message : 'O bot não respondeu.',
    };
  }
}

/** `1.2 GB`, `384 MB`… — bytes num rótulo curto. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit] ?? 'KB'}`;
}

/** `3d 4h`, `12h 30m`, `45s` — uptime legível sem biblioteca de datas. */
export function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  if (days > 0) return `${String(days)}d ${String(hours)}h`;
  if (hours > 0) return `${String(hours)}h ${String(minutes)}m`;
  if (minutes > 0) return `${String(minutes)}m`;
  return `${String(totalSeconds)}s`;
}
