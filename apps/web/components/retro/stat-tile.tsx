import { cn } from 'cn';

/** §6.7 — label micro `>`, valor grande tabular e delta com `▲`/`▼` literais. */
export function StatTile({
  label,
  value,
  delta,
  hint,
  chart,
  className,
}: {
  label: string;
  value: string;
  /** Variação percentual do período; positivo sobe, negativo desce. */
  delta?: number | null;
  hint?: string;
  /** Sparkline opcional (§6.7), renderizada abaixo do valor. */
  chart?: React.ReactNode;
  className?: string;
}) {
  return (
    <article className={cn('panel flex flex-col gap-3 p-4', className)}>
      <p className="section-label sigil">{label}</p>
      <p className="stat-value">{value}</p>
      {delta !== undefined && delta !== null ? (
        <p
          className={cn(
            'text-[10px] uppercase tracking-[0.2em] tabular-nums',
            delta >= 0 ? 'text-success-text' : 'text-error-text',
          )}
        >
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
        </p>
      ) : null}
      {hint ? <p className="screen-meta">{hint}</p> : null}
      {chart ? <div className="mt-auto h-10">{chart}</div> : null}
    </article>
  );
}
