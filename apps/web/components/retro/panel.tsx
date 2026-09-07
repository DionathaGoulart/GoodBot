import { cn } from 'cn';

import { WindowDots } from './window-dots';

/**
 * §6.2 — o card do painel. `title` liga a barra de título (§4.8); o nome vai
 * em caixa alta com cara de arquivo (`AUTOMOD.CFG`, `CASOS.LOG`).
 */
export function Panel({
  title,
  tone,
  actions,
  className,
  bodyClassName,
  children,
}: {
  title?: string;
  tone?: React.ComponentProps<typeof WindowDots>['tone'];
  actions?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn('panel', className)}>
      {title ? (
        <header className="window-bar">
          <span className="window-bar-title">{title}</span>
          <span className="flex items-center gap-3">
            {actions}
            <WindowDots tone={tone} />
          </span>
        </header>
      ) : null}
      <div className={cn('flex flex-col gap-4 p-4 sm:p-6', bodyClassName)}>{children}</div>
    </section>
  );
}
