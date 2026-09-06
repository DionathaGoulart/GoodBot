import { Panel } from '@/components/retro/panel';
import { EmptyState } from '@/components/retro/states';

/**
 * Moldura comum dos blocos de gráfico: `panel` com barra de título e, quando
 * a série está vazia, o estado `> AINDA SEM DADOS` do §8 no lugar do desenho.
 */
export function ChartPanel({
  title,
  meta,
  empty,
  emptyDescription = 'Nada foi coletado neste período. Assim que o bot registrar eventos, o gráfico aparece aqui.',
  className,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  empty: boolean;
  emptyDescription?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Panel title={title} actions={meta} className={className}>
      {empty ? <EmptyState title="AINDA SEM DADOS" description={emptyDescription} /> : children}
    </Panel>
  );
}
