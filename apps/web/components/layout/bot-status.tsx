import { PresenceDot, type Presence } from '@/components/retro/presence-dot';
import { cachedInternalApi } from '@/lib/internal-api';

export interface BotStatus {
  presence: Presence;
  pingMs: number | null;
  /** Tempo de vida do processo do bot; `null` quando ele não respondeu. */
  uptimeMs: number | null;
}

/**
 * §8 — o painel precisa dizer quando o bot não responde. `/health` é barato e
 * pode ficar 30s velho; qualquer erro conta como offline.
 */
export async function readBotStatus(): Promise<BotStatus> {
  try {
    const health = await cachedInternalApi(30).health();
    const presence: Presence =
      health.gateway.status === 'ready'
        ? 'online'
        : health.gateway.status === 'disconnected'
          ? 'offline'
          : 'reconnecting';
    return { presence, pingMs: health.gateway.pingMs, uptimeMs: health.uptimeMs };
  } catch {
    return { presence: 'offline', pingMs: null, uptimeMs: null };
  }
}

export function BotStatusIndicator({ status }: { status: BotStatus }) {
  const label = { online: 'ONLINE', offline: 'OFFLINE', reconnecting: 'RECONECTANDO' }[
    status.presence
  ];

  return (
    <span className="flex items-center gap-2">
      <PresenceDot status={status.presence} />
      <span className="screen-meta hidden sm:inline">
        {label}
        {status.pingMs === null ? '' : ` · ${status.pingMs}MS`}
      </span>
    </span>
  );
}

/** §8 — banner fixo abaixo da topbar enquanto o bot estiver fora. */
export function BotStatusBanner({ status }: { status: BotStatus }) {
  if (status.presence === 'online') return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 border-b-2 border-warning bg-base-200 px-4 py-2"
    >
      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-warning">
        ! BOT {status.presence === 'offline' ? 'OFFLINE' : 'RECONECTANDO'}
      </span>
      <span className="text-sm opacity-70">
        A API do bot não respondeu. Ações que dependem dele ficam indisponíveis até voltar.
      </span>
    </div>
  );
}
