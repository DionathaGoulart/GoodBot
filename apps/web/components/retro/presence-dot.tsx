import { cn } from 'cn';

export type Presence = 'online' | 'offline' | 'reconnecting';

/** §6.9 — quadrado de 12px com anel `base-200`. */
export function PresenceDot({ status, className }: { status: Presence; className?: string }) {
  const tone = {
    online: 'bg-success',
    offline: 'bg-error',
    reconnecting: 'bg-warning',
  }[status];

  return <span aria-hidden className={cn('presence-dot', tone, className)} />;
}
