import { cn } from 'cn';

import { Skeleton } from '@/components/ui/skeleton';

/** §8 — vazio: kicker, uma linha de explicação e um CTA quando faz sentido. */
export function EmptyState({
  title = 'NADA AQUI',
  description,
  action,
  className,
}: {
  title?: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 py-10 text-center', className)}>
      <p className="screen-kicker sigil">{title}</p>
      <p className="max-w-prose text-sm opacity-70">{description}</p>
      {action}
    </div>
  );
}

/** §8 — erro de carregamento: banner `error` no lugar do conteúdo. */
export function ErrorState({
  title = 'ERRO',
  description,
  requestId,
  action,
  className,
}: {
  title?: string;
  description: string;
  /** Aparece em micro-texto `select-all` para o usuário copiar no suporte. */
  requestId?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col gap-3 border-2 border-error bg-base-200 p-4', className)}
    >
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-error-text">! {title}</p>
      <p className="text-sm opacity-80">{description}</p>
      {requestId ? <p className="screen-meta select-all">REQUEST {requestId}</p> : null}
      {action}
    </div>
  );
}

/** §8 — loading de página: blocos listrados, nunca shimmer. */
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="screen-kicker terminal-cursor">CARREGANDO</p>
      <Skeleton className="h-10 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>
    </div>
  );
}
