import { cn } from 'cn';

/** §6.9 — kicker `>` + título de tela + meta em micro-texto, ações à direita. */
export function ScreenHeader({
  kicker,
  title,
  meta,
  actions,
  className,
}: {
  kicker?: string;
  title: string;
  meta?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="flex flex-col gap-1">
        {kicker ? <p className="screen-kicker sigil">{kicker}</p> : null}
        <h1 className="screen-title">{title}</h1>
        {meta ? <p className="screen-meta">{meta}</p> : null}
      </div>
      {/* As ações quebram linha: no celular quatro botões de período não cabem
          na mesma faixa do título e empurrariam a página na horizontal. */}
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
