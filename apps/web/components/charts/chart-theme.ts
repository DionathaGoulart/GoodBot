/**
 * Regras de §6.7 do styleguide traduzidas em props do Recharts. Todo gráfico
 * do painel importa daqui — cor, grid e eixo não se decidem no componente.
 */

/** Multi-série: no máximo 5, sempre nesta ordem. */
export const SERIES_COLORS = [
  'var(--accent)',
  'var(--info)',
  'var(--success)',
  'var(--warning)',
  'var(--error)',
] as const;

/** Comparação "período anterior": texto do tema esmaecido, nunca outra cor. */
export const COMPARISON_COLOR = 'color-mix(in oklab, var(--base-content) 30%, transparent)';

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length] as string;
}

/** Grid: só linhas horizontais, 1px, `base-300` a 20%, sem dash. */
export const GRID_PROPS = {
  vertical: false,
  horizontal: true,
  stroke: 'var(--base-300)',
  strokeOpacity: 0.2,
  strokeDasharray: undefined,
} as const;

/** Eixos: micro-texto a 60%, sem linha de eixo e sem tick line. */
export const AXIS_PROPS = {
  tickLine: false,
  axisLine: false,
  tickMargin: 8,
  tick: { fontSize: 10, letterSpacing: '0.1em', fill: 'currentColor', fillOpacity: 0.6 },
} as const;

/** §6.7 — nenhuma animação de entrada acima de 200ms. */
export const ANIMATION_MS = 200;

/** Linha: 2px, reta, sem dot. Curva suave contradiz a identidade. */
export const LINE_PROPS = {
  type: 'linear',
  strokeWidth: 2,
  dot: false,
  activeDot: { r: 3, strokeWidth: 0 },
  animationDuration: ANIMATION_MS,
} as const;

/** Barra: sólida, canto reto, 20% de gap. */
export const BAR_PROPS = {
  radius: 0,
  barGap: 4,
  animationDuration: ANIMATION_MS,
} as const;
