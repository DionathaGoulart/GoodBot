import { cn } from 'cn';

export interface HeatmapPoint {
  /** 0 = domingo, como o `dow` do Postgres. */
  weekday: number;
  hour: number;
  count: number;
}

const WEEKDAYS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

/** §6.7 — cinco degraus: 0 / 25 / 50 / 75 / 100% de `accent`. */
const STEPS = [0, 0.25, 0.5, 0.75, 1];

function step(count: number, max: number): number {
  if (count === 0 || max === 0) return 0;
  // `ceil` para que qualquer atividade acenda pelo menos o primeiro degrau.
  return Math.min(STEPS.length - 1, Math.ceil((count / max) * (STEPS.length - 1)));
}

/**
 * Mapa hora × dia da semana em grade CSS — 168 quadrados não justificam um
 * gráfico. Só buckets horários chegam aqui: depois do rollup (PRD §5.6) a hora
 * deixa de existir e a grade fica naturalmente mais rala no passado distante.
 */
export function ActivityHeatmap({ data }: { data: HeatmapPoint[] }) {
  const byCell = new Map(data.map((point) => [`${point.weekday}:${point.hour}`, point.count]));
  const max = data.reduce((highest, point) => Math.max(highest, point.count), 0);

  return (
    <div className="flex flex-col gap-3 overflow-x-auto">
      <div className="min-w-[34rem]">
        {WEEKDAYS.map((label, weekday) => (
          <div key={label} className="flex items-center gap-2">
            <span className="screen-meta w-10 shrink-0">{label}</span>
            <div className="grid flex-1 grid-cols-24 gap-[2px] py-[1px]">
              {Array.from({ length: 24 }, (_, hour) => {
                const count = byCell.get(`${weekday}:${hour}`) ?? 0;
                const opacity = STEPS[step(count, max)] ?? 0;
                return (
                  <div
                    key={hour}
                    title={`${label} ${String(hour).padStart(2, '0')}H · ${count} MSGS`}
                    className={cn('aspect-square border border-base-300/40')}
                    style={{ backgroundColor: 'var(--accent)', opacity: opacity || 0.06 }}
                  />
                );
              })}
            </div>
          </div>
        ))}
        <div className="mt-1 flex items-center gap-2">
          <span className="w-10 shrink-0" />
          <div className="grid flex-1 grid-cols-24 gap-[2px]">
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour} className="screen-meta text-center leading-none">
                {hour % 6 === 0 ? hour : ''}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="screen-meta">MENOS</span>
        {STEPS.map((opacity) => (
          <span
            key={opacity}
            className="size-3 border border-base-300/40"
            style={{ backgroundColor: 'var(--accent)', opacity: opacity || 0.06 }}
          />
        ))}
        <span className="screen-meta">MAIS · PICO {max}</span>
      </div>
    </div>
  );
}
