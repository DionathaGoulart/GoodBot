import { cn } from 'cn';

export interface HeatmapPoint {
  /** 0 = domingo, como o `dow` do Postgres. */
  weekday: number;
  hour: number;
  count: number;
}

const WEEKDAYS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const HOURS = Array.from({ length: 24 }, (_, hour) => (hour % 6 === 0 ? String(hour) : ''));

/** §6.7 — cinco degraus: 0 / 25 / 50 / 75 / 100% de `accent`. */
const STEPS = [0, 0.25, 0.5, 0.75, 1];

function step(count: number, max: number): number {
  if (count === 0 || max === 0) return 0;
  // `ceil` para que qualquer atividade acenda pelo menos o primeiro degrau.
  return Math.min(STEPS.length - 1, Math.ceil((count / max) * (STEPS.length - 1)));
}

export interface HeatmapGridProps {
  /** Rótulos das linhas, de cima para baixo. */
  rows: readonly string[];
  /** Rótulos das colunas; vazio esconde o rótulo daquela coluna, não a coluna. */
  columns: readonly string[];
  value: (row: number, column: number) => number;
  tooltip: (row: number, column: number, count: number) => string;
  /** Unidade depois do pico na legenda (`PICO 8 JOGADORES`). */
  legendUnit?: string;
  /** `false` esconde a legenda: numa grade de 0 e 1 ela não diz nada. */
  legend?: boolean;
  /** Largura mínima da grade; grade larga rola dentro do próprio contêiner. */
  minWidthClass?: string;
}

/**
 * §6.7 — grade de quadrados com a opacidade de `accent` em cinco degraus. As
 * colunas vêm do `gridTemplateColumns` inline, e não de uma classe
 * `grid-cols-N`, porque o número de colunas é de quem chama.
 */
export function HeatmapGrid({
  rows,
  columns,
  value,
  tooltip,
  legendUnit,
  legend = true,
  minWidthClass,
}: HeatmapGridProps) {
  const template = { gridTemplateColumns: `repeat(${String(columns.length)}, minmax(0, 1fr))` };
  let max = 0;
  for (let row = 0; row < rows.length; row++) {
    for (let column = 0; column < columns.length; column++) {
      max = Math.max(max, value(row, column));
    }
  }

  return (
    <div className="flex flex-col gap-3 overflow-x-auto">
      <div className={minWidthClass}>
        {rows.map((label, row) => (
          <div key={label} className="flex items-center gap-2">
            <span className="screen-meta w-10 shrink-0">{label}</span>
            <div className="grid flex-1 gap-[2px] py-[1px]" style={template}>
              {columns.map((_, column) => {
                const count = value(row, column);
                const opacity = STEPS[step(count, max)] ?? 0;
                return (
                  <div
                    key={column}
                    title={tooltip(row, column, count)}
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
          <div className="grid flex-1 gap-[2px]" style={template}>
            {columns.map((label, column) => (
              <span key={column} className="screen-meta truncate text-center leading-none">
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {legend ? (
        <div className="flex items-center gap-2">
          <span className="screen-meta">MENOS</span>
          {STEPS.map((opacity) => (
            <span
              key={opacity}
              className="size-3 border border-base-300/40"
              style={{ backgroundColor: 'var(--accent)', opacity: opacity || 0.06 }}
            />
          ))}
          <span className="screen-meta">
            MAIS · PICO {max}
            {legendUnit ? ` ${legendUnit}` : ''}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Mapa hora × dia da semana — 168 quadrados não justificam um gráfico. Só
 * buckets horários chegam aqui: depois do rollup (PRD §5.6) a hora deixa de
 * existir e a grade fica naturalmente mais rala no passado distante.
 */
export function ActivityHeatmap({ data }: { data: HeatmapPoint[] }) {
  const byCell = new Map(data.map((point) => [`${point.weekday}:${point.hour}`, point.count]));

  return (
    <HeatmapGrid
      rows={WEEKDAYS}
      columns={HOURS}
      value={(weekday, hour) => byCell.get(`${weekday}:${hour}`) ?? 0}
      tooltip={(weekday, hour, count) =>
        `${WEEKDAYS[weekday] ?? ''} ${String(hour).padStart(2, '0')}H · ${count} MSGS`
      }
      minWidthClass="min-w-[34rem]"
    />
  );
}
