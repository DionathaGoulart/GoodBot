import { cn } from 'cn';

/** §4.7 — três quadrados de janela. No Goodbot são quadrados, nunca círculos. */
export function WindowDots({
  tone = 'accent',
  className,
}: {
  /** Cor do primeiro ponto: sinaliza o status da "janela" (§6.5, §6.8). */
  tone?: 'accent' | 'error' | 'warning' | 'info' | 'success';
  className?: string;
}) {
  const first = {
    accent: 'bg-accent',
    error: 'bg-error',
    warning: 'bg-warning',
    info: 'bg-info',
    success: 'bg-success',
  }[tone];

  return (
    <span className={cn('flex items-center gap-1', className)} aria-hidden>
      <span className={cn('size-2', first)} />
      <span className="size-2 bg-base-300" />
      <span className="size-2 bg-base-300" />
    </span>
  );
}
