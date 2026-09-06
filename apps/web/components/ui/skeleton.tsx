import { cn } from 'cn';

/** §8 — listras diagonais estáticas; shimmer é proibido no retro. */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="skeleton" className={cn('skeleton-retro', className)} {...props} />;
}

export { Skeleton };
