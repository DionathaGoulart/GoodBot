import { cn } from 'cn';

export type TagTone = 'accent' | 'error' | 'warning' | 'info' | 'success' | 'muted';

/** §6.6 — badge preenchido; o mapeamento por ação de moderação está em §2.3. */
export function Tag({
  tone = 'accent',
  className,
  children,
}: {
  tone?: TagTone;
  className?: string;
  children: React.ReactNode;
}) {
  return <span className={cn('tag', `tag-${tone}`, className)}>{children}</span>;
}
